// ==UserScript==
// @name         DeerTune WebHID sniffer
// @namespace    https://github.com/N6l1/deer
// @version      1.0.0
// @description  Logs every WebHID report a page sends/receives, with labels you type. Read-only: it never sends anything itself.
// @match        https://drunkdeer-antler.com/*
// @match        https://beta.drunkdeer-antler.com/*
// @match        https://*.drunkdeer-antler.com/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function () {
  'use strict';
  if (window.__deerSniffer) return;
  if (!('HIDDevice' in window)) {
    alert('DeerTune sniffer: this browser has no WebHID.');
    return;
  }

  const log = [];
  const state = { label: 'baseline', paused: false, t0: performance.now() };
  const hex = (buf) => {
    const u8 = buf instanceof DataView ? new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength) : new Uint8Array(buf.buffer || buf, buf.byteOffset || 0, buf.byteLength);
    return Array.from(u8, (b) => b.toString(16).padStart(2, '0')).join(' ');
  };
  const name = (d) => (d ? `${d.productName || '?'} ${d.vendorId.toString(16)}:${d.productId.toString(16)}` : '?');
  const record = (dir, device, reportId, data) => {
    if (state.paused) return;
    const e = { t: Math.round(performance.now() - state.t0), label: state.label, dir, device: name(device), reportId, hex: hex(data) };
    log.push(e);
    ui && ui.update();
  };

  // ---- patch outgoing calls ----------------------------------------------------------
  const P = HIDDevice.prototype;
  const listening = new WeakSet();
  const attach = (dev) => {
    if (!dev || listening.has(dev)) return;
    listening.add(dev);
    dev.addEventListener('inputreport', (ev) => record('IN', dev, ev.reportId, ev.data));
  };
  const wrap = (fnName, dir) => {
    const orig = P[fnName];
    if (!orig) return;
    P[fnName] = function (reportId, data) {
      attach(this);
      if (dir === 'GET') {
        return orig.call(this, reportId).then((res) => (record('FEATURE_IN', this, reportId, res), res));
      }
      record(dir, this, reportId, data);
      return orig.apply(this, arguments);
    };
  };
  wrap('sendReport', 'OUT');
  wrap('sendFeatureReport', 'FEATURE_OUT');
  wrap('receiveFeatureReport', 'GET');
  const origOpen = P.open;
  P.open = function () {
    attach(this);
    return origOpen.apply(this, arguments);
  };
  if (navigator.hid) navigator.hid.getDevices().then((ds) => ds.forEach(attach)).catch(() => {});

  // ---- export -------------------------------------------------------------------------
  const asText = () =>
    [
      `# DeerTune WebHID capture`,
      `# page: ${location.href}`,
      `# date: ${new Date().toISOString()}`,
      `# ua: ${navigator.userAgent}`,
      `# format: t_ms | label | dir | report_id | bytes`,
      ...log.map((e) => `${e.t} | ${e.label} | ${e.dir} | ${e.reportId} | ${e.hex}`),
    ].join('\n');
  const download = () => {
    const blob = new Blob([asText()], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `deertune-capture-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`;
    a.click();
  };

  // ---- floating panel -------------------------------------------------------------------
  let ui = null;
  const mount = () => {
    if (ui || !document.body) return;
    const box = document.createElement('div');
    box.style.cssText =
      'position:fixed;z-index:2147483647;bottom:12px;left:12px;width:330px;font:12px/1.4 ui-monospace,monospace;background:#111;color:#eee;border:1px solid #ff6a1a;border-radius:10px;padding:10px;box-shadow:0 10px 30px #0008';
    box.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
        <b style="color:#ff8a3a">DeerTune sniffer</b><span id="ds-count">0</span>
      </div>
      <label style="display:block;margin-bottom:4px">Current step label</label>
      <div style="display:flex;gap:4px;margin-bottom:6px">
        <input id="ds-label" value="baseline" style="flex:1;background:#222;color:#fff;border:1px solid #444;border-radius:6px;padding:4px 6px">
        <button id="ds-set" style="background:#ff6a1a;color:#000;border:0;border-radius:6px;padding:4px 8px;cursor:pointer">Set</button>
      </div>
      <div style="display:flex;gap:4px;flex-wrap:wrap">
        <button id="ds-pause">Pause</button><button id="ds-copy">Copy</button><button id="ds-save">Export .txt</button><button id="ds-clear">Clear</button><button id="ds-min">_</button>
      </div>
      <pre id="ds-tail" style="margin:6px 0 0;max-height:120px;overflow:auto;white-space:pre-wrap;color:#9a9;font-size:10px"></pre>`;
    box.querySelectorAll('button').forEach((b) => {
      if (b.id !== 'ds-set') b.style.cssText = 'background:#222;color:#eee;border:1px solid #444;border-radius:6px;padding:3px 7px;cursor:pointer';
    });
    document.body.appendChild(box);
    const $ = (id) => box.querySelector('#' + id);
    const setLabel = () => {
      state.label = $('ds-label').value.trim() || 'unlabelled';
      log.push({ t: Math.round(performance.now() - state.t0), label: state.label, dir: 'MARK', device: '', reportId: '', hex: '' });
      ui.update();
    };
    $('ds-set').onclick = setLabel;
    $('ds-label').onkeydown = (e) => e.key === 'Enter' && setLabel();
    $('ds-pause').onclick = () => ((state.paused = !state.paused), ($('ds-pause').textContent = state.paused ? 'Resume' : 'Pause'));
    $('ds-copy').onclick = () => navigator.clipboard.writeText(asText()).then(() => ($('ds-copy').textContent = 'Copied'));
    $('ds-save').onclick = download;
    $('ds-clear').onclick = () => confirm('Clear the capture log?') && ((log.length = 0), ui.update());
    $('ds-min').onclick = () => ($('ds-tail').style.display = $('ds-tail').style.display === 'none' ? '' : 'none');
    ui = {
      update() {
        $('ds-count').textContent = `${log.length} reports`;
        $('ds-tail').textContent = log.slice(-6).map((e) => `${e.dir} [${e.label}] ${e.hex.slice(0, 60)}`).join('\n');
      },
    };
    ui.update();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();

  window.__deerSniffer = { log, setLabel: (l) => (state.label = l), export: asText, download };
  console.info('[DeerTune sniffer] active. Reports are logged; nothing is sent by the sniffer.');
})();
