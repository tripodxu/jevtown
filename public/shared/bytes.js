// 地图字节（人格 0..9999 → 反应序号 1..n，0 = 没看到）的 base64 编解码，Worker 与浏览器共用。
// Worker/Node 22 与浏览器都有全局 btoa/atob。

export function encodeBytes(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function decodeBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
