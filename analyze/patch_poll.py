import io

path = r'E:\File\deepseek harness\mil\rpen-milthm-bridge\main.mjs'
s = io.open(path, encoding='utf-8').read()

anchor = "  api.on('editor:chart', () => {"
assert anchor in s
poll = r'''  // Fallback poll: keep the panel/ExNote visibility in sync even if requestAnimationFrame
  // is throttled (background/occluded windows) and editor events do not arrive.
  let lastChartRef;
  const chartPoll = setInterval(() => {
    const chart = editor.chart;
    if (chart === lastChartRef) return;
    lastChartRef = chart;
    insertTimelineSelect();
    renderPanel();
    renderExCheckbox?.();
  }, 400);
  api.dispose(() => clearInterval(chartPoll));

''' + anchor
s = s.replace(anchor, poll, 1)
io.open(path, 'w', encoding='utf-8').write(s)
print('chart poll inserted')
