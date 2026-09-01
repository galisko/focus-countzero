let interval = null;
function tick(deadline) {
  const remaining = Math.max(0, deadline - Date.now());
  postMessage({ type: 'tick', remaining });
  if (remaining === 0) { clearInterval(interval); interval = null; postMessage({ type: 'complete' }); }
}
self.onmessage = ({ data }) => {
  if (data.type === 'start') {
    clearInterval(interval);
    tick(data.deadline);
    interval = setInterval(() => tick(data.deadline), 250);
  }
  if (data.type === 'stop') { clearInterval(interval); interval = null; }
};
