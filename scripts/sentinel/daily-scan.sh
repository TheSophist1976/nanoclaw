#!/bin/bash
# Sentinel Daily Quick Scan
# Runs on host before waking agent. Outputs JSON to stdout (last line).
# Exit cleanly — script errors should not prevent agent from processing partial results.

set -o pipefail

results='{}'

# --- 1. npm audit on NanoClaw ---
nanoclaw_dir="$(cd "$(dirname "$0")/../.." && pwd)"
npm_audit="[]"
if [ -f "$nanoclaw_dir/package-lock.json" ]; then
  raw=$(cd "$nanoclaw_dir" && npm audit --json 2>/dev/null) || true
  if [ -n "$raw" ]; then
    npm_audit=$(echo "$raw" | node -e "
      const fs = require('fs');
      const data = JSON.parse(fs.readFileSync('/dev/stdin','utf8'));
      const meta = data.metadata?.vulnerabilities || {};
      const vulns = Object.values(data.vulnerabilities || {}).map(v => ({
        name: v.name,
        severity: v.severity,
        title: v.via?.[0]?.title || v.via?.[0] || 'unknown',
        fixAvailable: !!v.fixAvailable,
        range: v.range
      })).filter(v => v.severity === 'critical' || v.severity === 'high');
      console.log(JSON.stringify({ summary: meta, critical_high: vulns }));
    " 2>/dev/null) || npm_audit='{"error":"parse failed"}'
  fi
fi

# --- 2. npm audit on code projects in Mark-main ---
code_audits="[]"
mark_code="/home/sophist/Documents/Mark-main/code"
if [ -d "$mark_code" ]; then
  audits="["
  first=true
  for pkg in "$mark_code"/*/package-lock.json; do
    [ -f "$pkg" ] || continue
    dir=$(dirname "$pkg")
    name=$(basename "$dir")
    raw=$(cd "$dir" && npm audit --json 2>/dev/null) || true
    if [ -n "$raw" ]; then
      count=$(echo "$raw" | node -e "
        const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
        const m=d.metadata?.vulnerabilities||{};
        console.log(JSON.stringify({project:\"$name\",critical:m.critical||0,high:m.high||0,moderate:m.moderate||0}));
      " 2>/dev/null) || continue
      $first || audits+=","
      audits+="$count"
      first=false
    fi
  done
  audits+="]"
  code_audits="$audits"
fi

# --- 3. System updates ---
updates="[]"
if command -v apt &>/dev/null; then
  apt_raw=$(apt list --upgradable 2>/dev/null | grep -v "^Listing" | head -20) || true
  if [ -n "$apt_raw" ]; then
    updates=$(echo "$apt_raw" | node -e "
      const lines=require('fs').readFileSync('/dev/stdin','utf8').trim().split('\n').filter(Boolean);
      const pkgs=lines.map(l=>{const m=l.match(/^(\S+)/);return m?m[1]:'unknown'});
      const security=lines.filter(l=>l.includes('security')).map(l=>{const m=l.match(/^(\S+)/);return m?m[1]:'unknown'});
      console.log(JSON.stringify({total:pkgs.length,security_updates:security,sample:pkgs.slice(0,10)}));
    " 2>/dev/null) || updates='{"error":"parse failed"}'
  else
    updates='{"total":0,"security_updates":[],"sample":[]}'
  fi
fi

# --- 4. Open ports ---
ports="[]"
if command -v ss &>/dev/null; then
  ports=$(ss -tlnp 2>/dev/null | tail -n +2 | \
    node -e "
      const lines=require('fs').readFileSync('/dev/stdin','utf8').trim().split('\n').filter(Boolean);
      const parsed=lines.map(l=>{
        const parts=l.split(/\s+/);
        const local=parts[3]||'';
        const proc=(parts[5]||'').match(/\"([^\"]+)\"/);
        return {listen:local,process:proc?proc[1]:'unknown'};
      });
      console.log(JSON.stringify(parsed));
    " 2>/dev/null) || ports='{"error":"parse failed"}'
fi

# --- 5. Check for secrets in recent git commits ---
secrets_found="[]"
if [ -d "$nanoclaw_dir/.git" ]; then
  secrets_found=$(cd "$nanoclaw_dir" && git log --since="24 hours ago" --diff-filter=A -p 2>/dev/null | \
    grep -inE '(api[_-]?key|secret[_-]?key|password|token|private[_-]?key)\s*[:=]' | \
    head -5 | \
    node -e "
      const lines=require('fs').readFileSync('/dev/stdin','utf8').trim().split('\n').filter(Boolean);
      console.log(JSON.stringify(lines.map(l=>l.trim().slice(0,100))));
    " 2>/dev/null) || secrets_found="[]"
fi

# --- 6. Failed login attempts (last 24h) ---
failed_logins='{"error":"no auth log"}'
auth_log="/var/log/auth.log"
if [ -r "$auth_log" ]; then
  yesterday=$(date -d "24 hours ago" "+%b %e")
  today=$(date "+%b %e")
  failed_logins=$(grep -E "Failed password|authentication failure|Invalid user" "$auth_log" 2>/dev/null | \
    grep -E "^($yesterday|$today)" | \
    node -e "
      const lines=require('fs').readFileSync('/dev/stdin','utf8').trim().split('\n').filter(Boolean);
      const byIp={};
      const byUser={};
      for(const l of lines){
        const ip=(l.match(/from (\d+\.\d+\.\d+\.\d+)/)||[])[1]||'unknown';
        const user=(l.match(/(?:user |for )(\S+)/)||[])[1]||'unknown';
        byIp[ip]=(byIp[ip]||0)+1;
        byUser[user]=(byUser[user]||0)+1;
      }
      console.log(JSON.stringify({
        total:lines.length,
        by_ip:Object.entries(byIp).sort((a,b)=>b[1]-a[1]).slice(0,10).map(([ip,n])=>({ip,count:n})),
        by_user:Object.entries(byUser).sort((a,b)=>b[1]-a[1]).slice(0,10).map(([u,n])=>({user:u,count:n}))
      }));
    " 2>/dev/null) || failed_logins='{"total":0,"by_ip":[],"by_user":[]}'
elif [ -r "/var/log/secure" ]; then
  # RHEL/CentOS
  failed_logins=$(grep -c "Failed password" /var/log/secure 2>/dev/null | \
    node -e "const n=parseInt(require('fs').readFileSync('/dev/stdin','utf8'));console.log(JSON.stringify({total:n||0}))" 2>/dev/null) || failed_logins='{"total":0}'
else
  failed_logins='{"total":0,"note":"auth log not readable"}'
fi

# --- 7. Docker socket exposure ---
docker_socket='{"checked":false}'
if [ -e /var/run/docker.sock ]; then
  sock_perms=$(stat -c '%a %U %G' /var/run/docker.sock 2>/dev/null) || sock_perms="unknown"
  sock_mode=$(echo "$sock_perms" | cut -d' ' -f1)
  sock_owner=$(echo "$sock_perms" | cut -d' ' -f2)
  sock_group=$(echo "$sock_perms" | cut -d' ' -f3)
  # Check if socket is world-accessible
  world_accessible="false"
  if [ "${sock_mode: -1}" != "0" ] 2>/dev/null; then
    world_accessible="true"
  fi
  # Check if non-root users are in docker group
  docker_users=$(getent group docker 2>/dev/null | cut -d: -f4) || docker_users=""
  docker_socket="{\"exists\":true,\"mode\":\"$sock_mode\",\"owner\":\"$sock_owner\",\"group\":\"$sock_group\",\"world_accessible\":$world_accessible,\"docker_group_members\":\"$docker_users\"}"
fi

# --- 8. SSL/TLS certificate expiry for local services ---
ssl_certs="[]"
# Check common local service ports for SSL certs
check_ssl_port() {
  local host=$1 port=$2 name=$3
  local expiry
  expiry=$(echo | openssl s_client -connect "$host:$port" -servername "$host" 2>/dev/null | \
    openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2) || return
  if [ -n "$expiry" ]; then
    local expiry_epoch days_left
    expiry_epoch=$(date -d "$expiry" +%s 2>/dev/null) || return
    days_left=$(( (expiry_epoch - $(date +%s)) / 86400 ))
    echo "{\"service\":\"$name\",\"port\":$port,\"expires\":\"$expiry\",\"days_left\":$days_left}"
  fi
}

if command -v openssl &>/dev/null; then
  certs="["
  first=true
  # Check common ports: HTTPS, custom services
  for entry in "localhost:443:https" "localhost:8443:https-alt" "localhost:3000:dev-server"; do
    IFS=: read -r host port name <<< "$entry"
    cert_info=$(check_ssl_port "$host" "$port" "$name" 2>/dev/null) || true
    if [ -n "$cert_info" ]; then
      $first || certs+=","
      certs+="$cert_info"
      first=false
    fi
  done
  # Also check any custom certs in common locations
  for certfile in /etc/ssl/certs/localhost*.pem /etc/letsencrypt/live/*/cert.pem; do
    [ -f "$certfile" ] || continue
    expiry=$(openssl x509 -in "$certfile" -noout -enddate 2>/dev/null | cut -d= -f2) || continue
    if [ -n "$expiry" ]; then
      expiry_epoch=$(date -d "$expiry" +%s 2>/dev/null) || continue
      days_left=$(( (expiry_epoch - $(date +%s)) / 86400 ))
      $first || certs+=","
      certs+="{\"service\":\"cert-file\",\"path\":\"$certfile\",\"expires\":\"$expiry\",\"days_left\":$days_left}"
      first=false
    fi
  done
  certs+="]"
  ssl_certs="$certs"
fi

# --- 9. API usage (last 24h) ---
api_usage='{"error":"db not found"}'
db_path="$nanoclaw_dir/store/messages.db"
if [ -f "$db_path" ]; then
  since=$(date -u -d "24 hours ago" "+%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || date -u -v-24H "+%Y-%m-%dT%H:%M:%SZ")
  api_usage=$(node -e "
    const Database = require('better-sqlite3');
    const db = new Database('$db_path', { readonly: true });
    try {
      const totals = db.prepare(\`SELECT
        COALESCE(SUM(input_tokens),0) as input,
        COALESCE(SUM(output_tokens),0) as output,
        COALESCE(SUM(cache_creation_input_tokens),0) as cache_write,
        COALESCE(SUM(cache_read_input_tokens),0) as cache_read,
        COALESCE(SUM(estimated_cost_usd),0) as cost,
        COUNT(*) as requests
        FROM api_usage WHERE timestamp >= '$since'\`).get();
      const byModel = db.prepare(\`SELECT model,
        COALESCE(SUM(input_tokens),0) as input,
        COALESCE(SUM(output_tokens),0) as output,
        COALESCE(SUM(estimated_cost_usd),0) as cost,
        COUNT(*) as requests
        FROM api_usage WHERE timestamp >= '$since'
        GROUP BY model ORDER BY cost DESC\`).all();
      console.log(JSON.stringify({
        period:'24h',
        total_input_tokens:totals.input,
        total_output_tokens:totals.output,
        total_cache_write_tokens:totals.cache_write,
        total_cache_read_tokens:totals.cache_read,
        estimated_cost_usd:Math.round(totals.cost*10000)/10000,
        request_count:totals.requests,
        by_model:byModel.map(m=>({model:m.model,input:m.input,output:m.output,cost:Math.round(m.cost*10000)/10000,requests:m.requests}))
      }));
    } catch(e) { console.log(JSON.stringify({error:e.message})); }
    db.close();
  " 2>/dev/null) || api_usage='{"error":"query failed"}'
fi

# --- Assemble output ---
echo "{\"wakeAgent\":true,\"data\":{\"scan_type\":\"daily\",\"timestamp\":\"$(date -Iseconds)\",\"npm_audit\":$npm_audit,\"code_project_audits\":$code_audits,\"system_updates\":$updates,\"open_ports\":$ports,\"secrets_in_commits\":$secrets_found,\"failed_logins\":$failed_logins,\"docker_socket\":$docker_socket,\"ssl_certificates\":$ssl_certs,\"api_usage\":$api_usage}}"
