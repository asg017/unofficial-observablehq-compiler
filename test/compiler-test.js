const test = require("tape");
const runtime = require("@observablehq/runtime");
const compiler = require("../dist/index");

test("compiler", async t => {
  const rt = new runtime.Runtime();
  const compile = new compiler.Compiler();
  const define = compile.module(`
a = 1

b = 2

c = a + b

d = {
  yield 1;
  yield 2;
  yield 3;
}

viewof e = {
  let output = {};
  let listeners = [];
  output.value = 10;
  output.addEventListener = (listener) => listeners.push(listener);;
  output.removeEventListener = (listener) => {
    listeners = listeners.filter(l => l !== listener);
  };
  return output;
}
    `);
  const main = rt.module(define);
  await rt._compute();

  t.equal(await main.value("a"), 1);
  t.equal(await main.value("b"), 2);
  t.equal(await main.value("c"), 3);

  t.equal(await main.value("d"), 1);
  t.equal(await main.value("d"), 2);
  t.equal(await main.value("d"), 3);

  t.equal(await main.value("e"), 10);
  t.deepEqual(Object.keys(await main.value("viewof e")), [
    "value",
    "addEventListener",
    "removeEventListener"
  ]);

  rt.dispose();

  t.end();
});
