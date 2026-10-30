// One in-flight write, FIFO control queue, one replaceable full-state mailbox.
export function createPeer(ws, { maxQueuedBytes = 65536, maxBufferedBytes = 262144, now = () => performance.now(), onError = code => console.error(code) } = {}) {
  const queue = [];
  let latest = null;
  let writing = false;
  let writingAt = 0;
  let controls = 0;
  let bytes = 0;
  let disposed = false;
  let ending = null;
  const size = data => data === null ? 0 : Buffer.byteLength(data);
  function clearState() { bytes -= size(latest); latest = null; }
  function dispose() { disposed = true; queue.length = 0; latest = null; bytes = 0; }
  function abort() { dispose(); ws.close(1013, 'Slow receiver.'); }
  function withinBounds() {
    if (bytes > maxQueuedBytes || ws.bufferedAmount > maxBufferedBytes) { abort(); return false; }
    return true;
  }
  function pump() {
    if (disposed || writing || ws.readyState !== 1) return;
    const isControl = queue.length > 0;
    const data = isControl ? queue.shift() : latest;
    if (data === null || data === undefined) {
      if (ending) { const { code, reason } = ending; dispose(); ws.close(code, reason); }
      return;
    }
    if (!isControl) latest = null;
    writing = true;
    writingAt = now();
    const fail = () => { if (disposed) return; onError('send_error'); dispose(); ws.close(1011, 'Internal server error.'); };
    try {
      ws.send(data, error => {
        if (disposed) return;
        if (error) { fail(); return; }
        bytes -= size(data);
        if (isControl) controls--;
        writing = false;
        pump();
      });
    } catch { fail(); }
  }
  return {
    control(value) {
      if (disposed || ending) return;
      if (controls >= 32) { abort(); return; }
      const data = JSON.stringify(value);
      controls++; bytes += size(data); queue.push(data);
      if (withinBounds()) pump();
    },
    state(value) {
      if (disposed || ending) return;
      const data = JSON.stringify(value);
      bytes += size(data) - size(latest); latest = data;
      if (withinBounds()) pump();
    },
    poll() {
      if (disposed) return;
      if (ws.readyState !== 1) { dispose(); return; }
      if (!withinBounds()) return;
      if (writing && now() - writingAt >= 10000) { ws.terminate(); abort(); }
    },
    clearState,
    end(code, reason = '') { if (disposed || ending) return; clearState(); ending = { code, reason }; pump(); },
    dispose,
  };
}
