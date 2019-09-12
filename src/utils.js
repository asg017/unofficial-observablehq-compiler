export const extractPath = path => {
  let source = path;
  let m;

  // "https://api.observablehq.com/@jashkenas/inputs.js?v=3" => strip off ".js"
  if ((m = /\.js(\?|$)/i.exec(source))) source = source.slice(0, m.index);

  // "74f872c4fde62e35" => "d/..."
  if ((m = /^[0-9a-f]{16}$/i.test(source))) source = `d/${source}`;

  // link of notebook
  if ((m = /^https:\/\/(api\.|beta\.|)observablehq\.com\//i.exec(source)))
    source = source.slice(m[0].length);
  return source;
};
