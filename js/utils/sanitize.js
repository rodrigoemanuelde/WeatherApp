(function (global) {
  const utils = global.WandrUtils = global.WandrUtils || {};

  function sanitizeInput(value, maxLen) {
    if (value === null || value === undefined) return '';
    if (typeof value !== 'string') return String(value);
    return value
      .replace(/[<>'";&]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, maxLen);
  }

  function sanitizeCityName(value, maxLen) {
    if (!value) return '';
    return value
      .replace(/[<>;"&]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, maxLen);
  }

  function sanitizeAddress(value, maxLen) {
    if (!value) return '';
    return value
      .replace(/[<>'"&]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, maxLen);
  }

  function sanitizeNote(value, maxLen) {
    if (!value) return '';
    return value
      .replace(/[<>]/g, '')
      .trim()
      .slice(0, maxLen);
  }

  utils.sanitizeInput = sanitizeInput;
  utils.sanitizeCityName = sanitizeCityName;
  utils.sanitizeAddress = sanitizeAddress;
  utils.sanitizeNote = sanitizeNote;
})(window);
