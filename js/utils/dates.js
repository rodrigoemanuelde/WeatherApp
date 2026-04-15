(function (global) {
  const utils = global.WandrUtils = global.WandrUtils || {};

  function formatDate(value) {
    if (!value) return '';
    const d = new Date(value + 'T00:00:00');
    const months = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
    return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
  }

  function getWeekday(value) {
    return new Date(value + 'T00:00:00')
      .toLocaleDateString('es-AR', { weekday: 'short' })
      .slice(0, 3);
  }

  function getWeekdayFull(value) {
    return new Date(value + 'T00:00:00').toLocaleDateString('es-AR', { weekday: 'long' });
  }

  utils.formatDate = formatDate;
  utils.getWeekday = getWeekday;
  utils.getWeekdayFull = getWeekdayFull;
})(window);
