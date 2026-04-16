#!/usr/bin/env node
/**
 * Parse nmap XML scan results into a compact JSON summary.
 * Usage: node parse-nmap.mjs <hosts.xml> <ports.xml> [host-diff] [port-diff]
 *
 * Arguments:
 *   hosts.xml   - nmap host discovery XML (-sn scan)
 *   ports.xml   - nmap port scan XML (-sS -sV scan)
 *   host-diff   - ndiff output for hosts (optional, pass "" to skip)
 *   port-diff   - ndiff output for ports (optional, pass "" to skip)
 */

import fs from 'fs';

const [hostsFile, portsFile, hostDiffFile, portDiffFile] = process.argv.slice(2);

if (!hostsFile || !portsFile) {
  console.error('Usage: node parse-nmap.mjs <hosts.xml> <ports.xml> [host-diff-file] [port-diff-file]');
  process.exit(1);
}

// Parse hosts XML
const hostsXml = fs.readFileSync(hostsFile, 'utf-8');
const hosts = [];
const hostBlocks = hostsXml.split('<host>').slice(1);

for (const block of hostBlocks) {
  const ipMatch = block.match(/addr="([0-9.]+)" addrtype="ipv4"/);
  const macMatch = block.match(/addr="([0-9A-Fa-f:]+)" addrtype="mac"/);
  const vendorMatch = block.match(/addrtype="mac" vendor="([^"]+)"/);
  const hostnameMatch = block.match(/hostname name="([^"]+)"/);

  if (ipMatch) {
    hosts.push({
      ip: ipMatch[1],
      mac: macMatch ? macMatch[1] : null,
      vendor: vendorMatch ? vendorMatch[1] : null,
      hostname: hostnameMatch ? hostnameMatch[1] : null,
    });
  }
}

// Parse ports XML
const portsXml = fs.readFileSync(portsFile, 'utf-8');
const openPorts = {};
const portHostBlocks = portsXml.split('<host ').slice(1);

for (const block of portHostBlocks) {
  const ipMatch = block.match(/addr="([0-9.]+)" addrtype="ipv4"/);
  if (!ipMatch) continue;

  const ip = ipMatch[1];
  const ports = [];

  // Match each port block individually
  const portRegex = /<port protocol="(\w+)" portid="(\d+)">(.*?)<\/port>/gs;
  let match;
  while ((match = portRegex.exec(block)) !== null) {
    const portBlock = match[3];
    const stateMatch = portBlock.match(/state="(\w+)"/);
    if (!stateMatch || stateMatch[1] !== 'open') continue;

    const nameMatch = portBlock.match(/name="([^"]*)"/);
    const productMatch = portBlock.match(/product="([^"]*)"/);
    const versionMatch = portBlock.match(/version="([^"]*)"/);

    ports.push({
      port: parseInt(match[2]),
      protocol: match[1],
      service: nameMatch ? nameMatch[1] : null,
      product: productMatch ? productMatch[1] : null,
      version: versionMatch ? versionMatch[1] : null,
    });
  }

  if (ports.length > 0) {
    openPorts[ip] = ports;
  }
}

// Read diffs if provided
let hostDiff = null;
let portDiff = null;

if (hostDiffFile && fs.existsSync(hostDiffFile)) {
  const content = fs.readFileSync(hostDiffFile, 'utf-8').trim();
  if (content) hostDiff = content;
}

if (portDiffFile && fs.existsSync(portDiffFile)) {
  const content = fs.readFileSync(portDiffFile, 'utf-8').trim();
  if (content) portDiff = content;
}

const summary = {
  scan_date: new Date().toISOString().split('T')[0],
  timestamp: new Date().toISOString(),
  hosts_up: hosts.length,
  hosts,
  open_ports: openPorts,
  changes: (hostDiff || portDiff) ? 'detected' : 'none',
  host_diff: hostDiff,
  port_diff: portDiff,
};

console.log(JSON.stringify(summary, null, 2));
