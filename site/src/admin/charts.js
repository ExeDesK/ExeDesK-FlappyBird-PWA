const SVG_NS = 'http://www.w3.org/2000/svg';

function svg(name, attrs = {}) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attrs)) {
    node.setAttribute(key, String(value));
  }
  return node;
}

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function clear(container) {
  container.replaceChildren();
}

function emptyState(container, message = 'Pas encore de données sur cette période.') {
  clear(container);
  const node = document.createElement('p');
  node.className = 'chart-empty';
  node.textContent = message;
  container.append(node);
}

function formatShortDate(value) {
  const date = new Date(`${value}T00:00:00Z`);
  return new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    timeZone: 'UTC',
  }).format(date);
}

export function renderLineChart(container, rows, {
  valueKey,
  secondaryKey = null,
  label = 'Série',
  secondaryLabel = '',
  valueFormatter = value => String(Math.round(value)),
} = {}) {
  const values = rows.map(row => finite(row[valueKey]));
  const secondary = secondaryKey ? rows.map(row => finite(row[secondaryKey])) : [];
  const all = secondaryKey ? [...values, ...secondary] : values;
  const max = Math.max(1, ...all);

  if (!rows.length || !all.some(value => value > 0)) {
    emptyState(container);
    return;
  }

  clear(container);
  const width = 760;
  const height = 260;
  const pad = { left: 46, right: 20, top: 18, bottom: 42 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const root = svg('svg', {
    viewBox: `0 0 ${width} ${height}`,
    role: 'img',
    'aria-label': secondaryKey ? `${label} et ${secondaryLabel}` : label,
  });
  root.classList.add('analytics-chart-svg');

  for (let i = 0; i <= 4; i += 1) {
    const y = pad.top + (plotH * i / 4);
    const amount = max * (1 - i / 4);
    root.append(svg('line', {
      x1: pad.left,
      y1: y,
      x2: width - pad.right,
      y2: y,
      class: 'chart-grid-line',
    }));
    const tick = svg('text', {
      x: pad.left - 8,
      y: y + 4,
      'text-anchor': 'end',
      class: 'chart-axis-label',
    });
    tick.textContent = valueFormatter(amount);
    root.append(tick);
  }

  const point = (value, index) => {
    const x = pad.left + (rows.length === 1 ? plotW / 2 : plotW * index / (rows.length - 1));
    const y = pad.top + plotH - (value / max) * plotH;
    return [x, y];
  };

  const drawSeries = (series, className) => {
    const points = series.map((value, index) => point(value, index));
    root.append(svg('polyline', {
      points: points.map(([x, y]) => `${x},${y}`).join(' '),
      fill: 'none',
      class: className,
    }));
    for (const [index, [x, y]] of points.entries()) {
      const circle = svg('circle', {
        cx: x,
        cy: y,
        r: 3,
        class: `${className} chart-point`,
      });
      const title = svg('title');
      title.textContent = `${formatShortDate(rows[index].activity_date)} · ${valueFormatter(series[index])}`;
      circle.append(title);
      root.append(circle);
    }
  };

  drawSeries(values, 'chart-primary');
  if (secondaryKey) drawSeries(secondary, 'chart-secondary');

  const labelIndexes = [...new Set([0, Math.floor((rows.length - 1) / 2), rows.length - 1])];
  for (const index of labelIndexes) {
    const [x] = point(0, index);
    const text = svg('text', {
      x,
      y: height - 14,
      'text-anchor': index === 0 ? 'start' : index === rows.length - 1 ? 'end' : 'middle',
      class: 'chart-axis-label',
    });
    text.textContent = formatShortDate(rows[index].activity_date);
    root.append(text);
  }

  container.append(root);
}

export function renderBarChart(container, rows, {
  valueKey,
  label = 'Série',
  valueFormatter = value => String(Math.round(value)),
} = {}) {
  const values = rows.map(row => finite(row[valueKey]));
  const max = Math.max(1, ...values);
  if (!rows.length || !values.some(value => value > 0)) {
    emptyState(container);
    return;
  }

  clear(container);
  const width = 760;
  const height = 260;
  const pad = { left: 44, right: 20, top: 18, bottom: 42 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const root = svg('svg', {
    viewBox: `0 0 ${width} ${height}`,
    role: 'img',
    'aria-label': label,
  });
  root.classList.add('analytics-chart-svg');

  for (let i = 0; i <= 4; i += 1) {
    const y = pad.top + (plotH * i / 4);
    root.append(svg('line', {
      x1: pad.left,
      y1: y,
      x2: width - pad.right,
      y2: y,
      class: 'chart-grid-line',
    }));
  }

  const slot = plotW / rows.length;
  const barW = Math.max(2, slot * 0.68);
  rows.forEach((row, index) => {
    const value = values[index];
    const barH = (value / max) * plotH;
    const rect = svg('rect', {
      x: pad.left + index * slot + (slot - barW) / 2,
      y: pad.top + plotH - barH,
      width: barW,
      height: barH,
      rx: 2,
      class: 'chart-bar',
    });
    const title = svg('title');
    title.textContent = `${formatShortDate(row.activity_date)} · ${valueFormatter(value)}`;
    rect.append(title);
    root.append(rect);
  });

  const labelIndexes = [...new Set([0, Math.floor((rows.length - 1) / 2), rows.length - 1])];
  for (const index of labelIndexes) {
    const text = svg('text', {
      x: pad.left + index * slot + slot / 2,
      y: height - 14,
      'text-anchor': index === 0 ? 'start' : index === rows.length - 1 ? 'end' : 'middle',
      class: 'chart-axis-label',
    });
    text.textContent = formatShortDate(rows[index].activity_date);
    root.append(text);
  }

  container.append(root);
}
