#!/bin/bash
# Sentinel Weekly Deep Scan
# Runs on host before waking agent. Outputs JSON to stdout (last line).
# Includes everything from daily scan plus deeper checks.

set -o pipefail

nanoclaw_dir="$(cd "$(dirname "$0")/../.." && pwd)"
mark_main="/home/sophist/Documents/Mark-main"

# --- 1. npm audit on NanoClaw (full detail) ---
npm_audit='{"error":"no package-lock.json"}'
if [ -f "$nanoclaw_dir/package-lock.json" ]; then
  raw=$(cd "$nanoclaw_dir" && npm audit --json 2>/dev/null) || true
  if [ -n "$raw" ]; then
    npm_audit=$(echo "$raw" | node -e "
      const data=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
      const meta=data.metadata?.vulnerabilities||{};
      const vulns=Object.values(data.vulnerabilities||{}).map(v=>({
        name:v.name,severity:v.severity,
        title:v.via?.[0]?.title||v.via?.[0]||'unknown',
        fixAvailable:!!v.fixAvailable,range:v.range,isDirect:v.isDirect||false
      }));
      console.log(JSON.stringify({summary:meta,all_vulnerabilities:vulns,total_deps:data.metadata?.totalDependencies||0}));
    " 2>/dev/null) || npm_audit='{"error":"parse failed"}'
  fi
fi

# --- 2. npm audit on code projects ---
code_audits="[]"
mark_code="$mark_main/code"
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
        const vulns=Object.values(d.vulnerabilities||{}).filter(v=>v.severity==='critical'||v.severity==='high').map(v=>({
          name:v.name,severity:v.severity,title:v.via?.[0]?.title||v.via?.[0]||'unknown'
        }));
        console.log(JSON.stringify({project:\"$name\",summary:m,critical_high:vulns,total_deps:d.metadata?.totalDependencies||0}));
      " 2>/dev/null) || continue
      $first || audits+=","
      audits+="$count"
      first=false
    fi
  done
  audits+="]"
  code_audits="$audits"
fi

# --- 3. pip audit on Python projects ---
pip_audits="[]"
if command -v pip &>/dev/null || command -v pip3 &>/dev/null; then
  pip_cmd=$(command -v pip3 || command -v pip)
  pip_audits_arr="["
  first=true
  # Check for virtual environments in code projects
  for venv in "$mark_code"/*/venv "$mark_code"/*/.venv "$nanoclaw_dir/venv" "$nanoclaw_dir/.venv"; do
    [ -d "$venv" ] || continue
    proj=$(basename "$(dirname "$venv")")
    # Use pip-audit if available, otherwise just list outdated
    if command -v pip-audit &>/dev/null; then
      audit_out=$(cd "$(dirname "$venv")" && pip-audit --format=json 2>/dev/null) || true
      if [ -n "$audit_out" ]; then
        count=$(echo "$audit_out" | node -e "
          const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
          const vulns=(d.dependencies||[]).filter(dep=>dep.vulns&&dep.vulns.length>0);
          console.log(JSON.stringify({project:\"$proj\",vulnerabilities:vulns.length,details:vulns.slice(0,5).map(v=>({name:v.name,version:v.version,vulns:v.vulns.map(x=>x.id)}))}));
        " 2>/dev/null) || continue
        $first || pip_audits_arr+=","
        pip_audits_arr+="$count"
        first=false
      fi
    fi
  done
  # Also check system pip for outdated packages
  outdated=$($pip_cmd list --outdated --format=json 2>/dev/null | node -e "
    const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    console.log(JSON.stringify({system_outdated:d.length,packages:d.slice(0,5).map(p=>({name:p.name,current:p.version,latest:p.latest_version}))}));
  " 2>/dev/null) || outdated='{"system_outdated":0}'
  if [ "$first" = true ]; then
    pip_audits_arr+="$outdated"
  else
    pip_audits_arr+=",$outdated"
  fi
  pip_audits_arr+="]"
  pip_audits="$pip_audits_arr"
fi

# --- 4. System updates (full list) ---
updates='{"error":"apt not available"}'
if command -v apt &>/dev/null; then
  apt_raw=$(apt list --upgradable 2>/dev/null | grep -v "^Listing") || true
  if [ -n "$apt_raw" ]; then
    updates=$(echo "$apt_raw" | node -e "
      const lines=require('fs').readFileSync('/dev/stdin','utf8').trim().split('\n').filter(Boolean);
      const pkgs=lines.map(l=>{const m=l.match(/^(\S+)/);return m?m[1]:'unknown'});
      const security=lines.filter(l=>l.includes('security')).map(l=>{const m=l.match(/^(\S+)/);return m?m[1]:'unknown'});
      console.log(JSON.stringify({total:pkgs.length,security_updates:security,all_packages:pkgs}));
    " 2>/dev/null) || updates='{"error":"parse failed"}'
  else
    updates='{"total":0,"security_updates":[],"all_packages":[]}'
  fi
fi

# --- 5. Open ports (detailed) ---
ports="[]"
if command -v ss &>/dev/null; then
  ports=$(ss -tlnp 2>/dev/null | tail -n +2 | \
    node -e "
      const lines=require('fs').readFileSync('/dev/stdin','utf8').trim().split('\n').filter(Boolean);
      const parsed=lines.map(l=>{
        const parts=l.split(/\s+/);
        const local=parts[3]||'';
        const proc=(parts[5]||'').match(/\"([^\"]+)\"/);
        const pid=(parts[5]||'').match(/pid=(\d+)/);
        return {listen:local,process:proc?proc[1]:'unknown',pid:pid?pid[1]:'unknown'};
      });
      console.log(JSON.stringify(parsed));
    " 2>/dev/null) || ports='[]'
fi

# --- 6. LAN network scan ---
nmap_results='{"error":"nmap not installed"}'
if command -v nmap &>/dev/null; then
  nmap_results=$(nmap -sn 192.168.50.0/24 2>/dev/null | \
    node -e "
      const raw=require('fs').readFileSync('/dev/stdin','utf8');
      const hosts=[];
      const blocks=raw.split('Nmap scan report for ').slice(1);
      for(const b of blocks){
        const lines=b.split('\n');
        const host=lines[0].trim();
        const mac=(b.match(/MAC Address: (\S+)/)||[])[1]||null;
        const vendor=(b.match(/MAC Address: \S+ \(([^)]+)\)/)||[])[1]||null;
        hosts.push({host,mac,vendor});
      }
      const total=(raw.match(/(\d+) hosts? up/)||[])[1]||0;
      console.log(JSON.stringify({hosts_up:parseInt(total),hosts:hosts}));
    " 2>/dev/null) || nmap_results='{"error":"scan failed"}'
else
  if command -v apt &>/dev/null; then
    sudo apt-get install -y nmap &>/dev/null && \
    nmap_results=$(nmap -sn 192.168.50.0/24 2>/dev/null | \
      node -e "
        const raw=require('fs').readFileSync('/dev/stdin','utf8');
        const hosts=[];
        const blocks=raw.split('Nmap scan report for ').slice(1);
        for(const b of blocks){
          const lines=b.split('\n');
          const host=lines[0].trim();
          const mac=(b.match(/MAC Address: (\S+)/)||[])[1]||null;
          const vendor=(b.match(/MAC Address: \S+ \(([^)]+)\)/)||[])[1]||null;
          hosts.push({host,mac,vendor});
        }
        const total=(raw.match(/(\d+) hosts? up/)||[])[1]||0;
        console.log(JSON.stringify({hosts_up:parseInt(total),hosts:hosts}));
      " 2>/dev/null) || nmap_results='{"error":"install or scan failed"}'
  fi
fi

# --- 7. Secrets in recent git commits (7 days) ---
secrets_found="[]"
if [ -d "$nanoclaw_dir/.git" ]; then
  secrets_found=$(cd "$nanoclaw_dir" && git log --since="7 days ago" --diff-filter=A -p 2>/dev/null | \
    grep -inE '(api[_-]?key|secret[_-]?key|password|token|private[_-]?key)\s*[:=]' | \
    head -20 | \
    node -e "
      const lines=require('fs').readFileSync('/dev/stdin','utf8').trim().split('\n').filter(Boolean);
      console.log(JSON.stringify(lines.map(l=>l.trim().slice(0,120))));
    " 2>/dev/null) || secrets_found="[]"
fi

# --- 8. File permission checks ---
perm_issues="[]"
perm_issues=$(find /home/sophist -maxdepth 3 \( \
  -name ".env" -o -name "*.pem" -o -name "*.key" -o -name "id_rsa" -o -name "id_ed25519" \
  -o -name "credentials.json" -o -name ".netrc" \
  \) -perm /o=r 2>/dev/null | head -10 | \
  node -e "
    const lines=require('fs').readFileSync('/dev/stdin','utf8').trim().split('\n').filter(Boolean);
    console.log(JSON.stringify(lines.map(f=>({file:f,issue:'world-readable'}))));
  " 2>/dev/null) || perm_issues="[]"

# --- 9. Docker security ---
docker_info='{"error":"docker not available"}'
if command -v docker &>/dev/null; then
  docker_info=$(node -e "
    const {execSync}=require('child_process');
    const containers=JSON.parse(execSync('docker ps --format json 2>/dev/null').toString().split('\n').filter(Boolean).map(l=>'['+l+']').join(',').replace(/\]\[/g,',') || '[]');
    const images=execSync('docker images --format \"{{.Repository}}:{{.Tag}} {{.Size}}\" 2>/dev/null').toString().trim().split('\n').filter(Boolean);
    const rootContainers=containers.filter(c=>!c.Labels?.includes('user='));
    console.log(JSON.stringify({running_containers:containers.length,images:images.slice(0,10),root_warning:rootContainers.length>0}));
  " 2>/dev/null) || docker_info='{"error":"parse failed"}'
fi

# --- 10. Docker socket exposure ---
docker_socket='{"checked":false}'
if [ -e /var/run/docker.sock ]; then
  sock_perms=$(stat -c '%a %U %G' /var/run/docker.sock 2>/dev/null) || sock_perms="unknown"
  sock_mode=$(echo "$sock_perms" | cut -d' ' -f1)
  sock_owner=$(echo "$sock_perms" | cut -d' ' -f2)
  sock_group=$(echo "$sock_perms" | cut -d' ' -f3)
  world_accessible="false"
  if [ "${sock_mode: -1}" != "0" ] 2>/dev/null; then
    world_accessible="true"
  fi
  docker_users=$(getent group docker 2>/dev/null | cut -d: -f4) || docker_users=""
  docker_socket="{\"exists\":true,\"mode\":\"$sock_mode\",\"owner\":\"$sock_owner\",\"group\":\"$sock_group\",\"world_accessible\":$world_accessible,\"docker_group_members\":\"$docker_users\"}"
fi

# --- 11. Container image scanning (trivy/grype) ---
image_scan='{"error":"no scanner installed"}'
if command -v trivy &>/dev/null; then
  image_scan=$(trivy image --severity HIGH,CRITICAL --format json nanoclaw-agent:latest 2>/dev/null | \
    node -e "
      const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
      const results=(d.Results||[]).flatMap(r=>(r.Vulnerabilities||[]).map(v=>({
        pkg:v.PkgName,severity:v.Severity,id:v.VulnerabilityID,title:v.Title?.slice(0,80)
      })));
      console.log(JSON.stringify({total:results.length,vulnerabilities:results.slice(0,20)}));
    " 2>/dev/null) || image_scan='{"error":"scan failed"}'
elif command -v grype &>/dev/null; then
  image_scan=$(grype nanoclaw-agent:latest -o json 2>/dev/null | \
    node -e "
      const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
      const matches=(d.matches||[]).filter(m=>m.vulnerability.severity==='High'||m.vulnerability.severity==='Critical');
      console.log(JSON.stringify({total:matches.length,vulnerabilities:matches.slice(0,20).map(m=>({
        pkg:m.artifact.name,severity:m.vulnerability.severity,id:m.vulnerability.id
      }))}));
    " 2>/dev/null) || image_scan='{"error":"scan failed"}'
else
  image_scan='{"error":"neither trivy nor grype installed — recommend: sudo apt install trivy"}'
fi

# --- 12. SSH config check ---
ssh_info='{"not_found":true}'
if [ -d /home/sophist/.ssh ]; then
  ssh_info=$(node -e "
    const fs=require('fs');
    const path=require('path');
    const sshDir='/home/sophist/.ssh';
    const files=fs.readdirSync(sshDir).map(f=>{
      const stat=fs.statSync(path.join(sshDir,f));
      const mode='0'+((stat.mode)&0o777).toString(8);
      return {file:f,mode:mode};
    });
    const configExists=fs.existsSync(path.join(sshDir,'config'));
    const authKeys=fs.existsSync(path.join(sshDir,'authorized_keys'));
    const permIssues=files.filter(f=>f.file.startsWith('id_')&&!f.file.endsWith('.pub')&&f.mode!=='0600');
    console.log(JSON.stringify({files:files,config_exists:configExists,authorized_keys:authKeys,permission_issues:permIssues}));
  " 2>/dev/null) || ssh_info='{"error":"parse failed"}'
fi

# --- 13. Firewall rules audit ---
firewall='{"error":"ufw not available"}'
if command -v ufw &>/dev/null; then
  # ufw status requires root; try iptables directly as fallback
  ufw_raw=$(sudo -n ufw status verbose 2>/dev/null) || true
  if [ -n "$ufw_raw" ]; then
    firewall=$(echo "$ufw_raw" | node -e "
      const raw=require('fs').readFileSync('/dev/stdin','utf8');
      const statusLine=raw.match(/Status: (\w+)/);
      const status=statusLine?statusLine[1]:'unknown';
      const defaultLine=raw.match(/Default: (.+)/);
      const defaults=defaultLine?defaultLine[1].trim():'unknown';
      const rules=[];
      const ruleLines=raw.split('\n').filter(l=>l.match(/^\d|^Anywhere/));
      for(const l of ruleLines) rules.push(l.trim());
      console.log(JSON.stringify({status:status,defaults:defaults,rules:rules}));
    " 2>/dev/null) || firewall='{"error":"parse failed"}'
  else
    # Fallback: check iptables rules count
    ipt_count=$(sudo -n iptables -L -n 2>/dev/null | grep -c "^[A-Z]" || echo "0")
    firewall="{\"error\":\"ufw requires sudo password\",\"iptables_chain_count\":$ipt_count,\"note\":\"add NOPASSWD for ufw status in sudoers to enable\"}"
  fi
fi

# --- 14. Systemd services running as root ---
systemd_root='[]'
if command -v systemctl &>/dev/null; then
  systemd_root=$(systemctl list-units --type=service --state=running --no-pager 2>/dev/null | \
    grep "\.service" | awk '{print $1}' | while read svc; do
      user=$(systemctl show "$svc" --property=User --value 2>/dev/null)
      if [ -z "$user" ] || [ "$user" = "root" ]; then
        echo "$svc"
      fi
    done | head -20 | \
    node -e "
      const lines=require('fs').readFileSync('/dev/stdin','utf8').trim().split('\n').filter(Boolean);
      console.log(JSON.stringify(lines));
    " 2>/dev/null) || systemd_root='[]'
fi

# --- 15. npm license audit ---
license_audit='{"error":"not available"}'
if [ -f "$nanoclaw_dir/package-lock.json" ]; then
  license_audit=$(cd "$nanoclaw_dir" && npx license-checker --json --production 2>/dev/null | \
    node -e "
      const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
      const licenses={};
      const flagged=[];
      const restrictive=['GPL-2.0','GPL-3.0','AGPL-3.0','SSPL-1.0','EUPL-1.1','EUPL-1.2','OSL-3.0'];
      for(const [pkg,info] of Object.entries(d)){
        const lic=info.licenses||'unknown';
        licenses[lic]=(licenses[lic]||0)+1;
        if(restrictive.some(r=>lic.includes(r))){
          flagged.push({package:pkg,license:lic});
        }
      }
      const sorted=Object.entries(licenses).sort((a,b)=>b[1]-a[1]).slice(0,10);
      console.log(JSON.stringify({total_packages:Object.keys(d).length,license_distribution:sorted,restrictive_licenses:flagged}));
    " 2>/dev/null) || license_audit='{"error":"license-checker failed"}'
fi

# --- 16. Athenaeum backup verification ---
backup_status='{"error":"backup dir not found"}'
backup_dir="/home/sophist/backups"
if [ -d "$backup_dir" ]; then
  backup_status=$(node -e "
    const fs=require('fs');
    const path=require('path');
    const dir='$backup_dir';
    const files=fs.readdirSync(dir).map(f=>{
      const stat=fs.statSync(path.join(dir,f));
      return {file:f,size:stat.size,modified:stat.mtime.toISOString()};
    }).sort((a,b)=>new Date(b.modified)-new Date(a.modified));
    const now=Date.now();
    const latestPg=files.find(f=>f.file.includes('athenaeum_pg'));
    const latestQdrant=files.find(f=>f.file.includes('qdrant'));
    const pgAge=latestPg?Math.floor((now-new Date(latestPg.modified).getTime())/3600000):null;
    const qdrantAge=latestQdrant?Math.floor((now-new Date(latestQdrant.modified).getTime())/3600000):null;
    const pgHealthy=latestPg&&latestPg.size>0&&pgAge<48;
    const qdrantHealthy=latestQdrant&&latestQdrant.size>0&&qdrantAge<48;
    console.log(JSON.stringify({
      total_files:files.length,
      latest_postgres:latestPg||null,
      latest_qdrant:latestQdrant||null,
      pg_age_hours:pgAge,
      qdrant_age_hours:qdrantAge,
      pg_healthy:pgHealthy||false,
      qdrant_healthy:qdrantHealthy||false,
      all_files:files.slice(0,10)
    }));
  " 2>/dev/null) || backup_status='{"error":"parse failed"}'
fi

# --- 17. Credential rotation tracking ---
credential_age='[]'
credential_age=$(node -e "
  const fs=require('fs');
  const path=require('path');
  const creds=[];
  // Check .env file age
  const envFile='/home/sophist/code/nanoclaw/.env';
  if(fs.existsSync(envFile)){
    const stat=fs.statSync(envFile);
    const ageDays=Math.floor((Date.now()-stat.mtimeMs)/86400000);
    creds.push({file:'.env',last_modified:stat.mtime.toISOString(),age_days:ageDays,warn:ageDays>90});
  }
  // Check SSH key ages
  const sshDir='/home/sophist/.ssh';
  if(fs.existsSync(sshDir)){
    for(const f of fs.readdirSync(sshDir)){
      if(f.startsWith('id_')&&!f.endsWith('.pub')){
        const stat=fs.statSync(path.join(sshDir,f));
        const ageDays=Math.floor((Date.now()-stat.mtimeMs)/86400000);
        creds.push({file:'~/.ssh/'+f,last_modified:stat.mtime.toISOString(),age_days:ageDays,warn:ageDays>365});
      }
    }
  }
  // Check OneCLI vault age if it exists
  const vaultDir='/home/sophist/.config/onecli';
  if(fs.existsSync(vaultDir)){
    const stat=fs.statSync(vaultDir);
    const ageDays=Math.floor((Date.now()-stat.mtimeMs)/86400000);
    creds.push({file:'onecli vault',last_modified:stat.mtime.toISOString(),age_days:ageDays,warn:ageDays>90});
  }
  console.log(JSON.stringify(creds));
" 2>/dev/null) || credential_age='[]'

# --- 18. SSL/TLS certificate expiry ---
ssl_certs="[]"
if command -v openssl &>/dev/null; then
  certs="["
  first=true
  for entry in "localhost:443:https" "localhost:8443:https-alt"; do
    IFS=: read -r host port name <<< "$entry"
    expiry=$(echo | openssl s_client -connect "$host:$port" -servername "$host" 2>/dev/null | \
      openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2) || true
    if [ -n "$expiry" ]; then
      expiry_epoch=$(date -d "$expiry" +%s 2>/dev/null) || continue
      days_left=$(( (expiry_epoch - $(date +%s)) / 86400 ))
      $first || certs+=","
      certs+="{\"service\":\"$name\",\"port\":$port,\"expires\":\"$expiry\",\"days_left\":$days_left}"
      first=false
    fi
  done
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

# --- 19. Previous report for tracking ---
prev_report=""
security_dir="$mark_main/Security"
if [ -d "$security_dir" ]; then
  latest=$(ls -t "$security_dir"/sentinel-weekly-*.md 2>/dev/null | head -1)
  if [ -n "$latest" ]; then
    prev_report=$(head -50 "$latest" 2>/dev/null | node -e "
      console.log(JSON.stringify(require('fs').readFileSync('/dev/stdin','utf8')));
    " 2>/dev/null) || prev_report='""'
  fi
fi
[ -z "$prev_report" ] && prev_report='null'

# --- Assemble output ---
echo "{\"wakeAgent\":true,\"data\":{\"scan_type\":\"weekly\",\"timestamp\":\"$(date -Iseconds)\",\"npm_audit\":$npm_audit,\"code_project_audits\":$code_audits,\"pip_audits\":$pip_audits,\"system_updates\":$updates,\"open_ports\":$ports,\"nmap_lan\":$nmap_results,\"secrets_in_commits\":$secrets_found,\"file_permissions\":$perm_issues,\"docker\":$docker_info,\"docker_socket\":$docker_socket,\"image_scan\":$image_scan,\"ssh\":$ssh_info,\"firewall\":$firewall,\"systemd_root_services\":$systemd_root,\"license_audit\":$license_audit,\"athenaeum_backups\":$backup_status,\"credential_age\":$credential_age,\"ssl_certificates\":$ssl_certs,\"previous_weekly_report\":$prev_report}}"
