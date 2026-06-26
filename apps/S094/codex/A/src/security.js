const crypto = require("crypto");
const dns = require("dns").promises;
const net = require("net");

function makeToken() {
  return crypto.randomBytes(24).toString("hex");
}

function normalizeUrl(rawUrl) {
  const url = new URL(rawUrl);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Only http and https URLs are supported.");
  }
  url.username = "";
  url.password = "";
  return url.toString();
}

function isPrivateIp(address) {
  if (net.isIPv4(address)) {
    const parts = address.split(".").map(Number);
    return (
      parts[0] === 10 ||
      parts[0] === 127 ||
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
      (parts[0] === 192 && parts[1] === 168) ||
      (parts[0] === 169 && parts[1] === 254) ||
      parts[0] === 0
    );
  }

  if (net.isIPv6(address)) {
    const lower = address.toLowerCase();
    return (
      lower === "::1" ||
      lower.startsWith("fc") ||
      lower.startsWith("fd") ||
      lower.startsWith("fe80:")
    );
  }

  return true;
}

async function assertPublicHttpUrl(rawUrl) {
  const normalized = normalizeUrl(rawUrl);
  const url = new URL(normalized);
  const host = url.hostname;
  const directIp = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true });

  if (directIp.some((record) => isPrivateIp(record.address))) {
    throw new Error("URL host must resolve to a public IP address.");
  }

  return normalized;
}

function assertAllowedUrlSyntax(rawUrl) {
  const normalized = normalizeUrl(rawUrl);
  const url = new URL(normalized);
  if (net.isIP(url.hostname) && isPrivateIp(url.hostname)) {
    throw new Error("URL host must be public.");
  }
  return normalized;
}

module.exports = { assertAllowedUrlSyntax, assertPublicHttpUrl, makeToken, normalizeUrl };
