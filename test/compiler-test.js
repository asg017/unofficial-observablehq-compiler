const test = require("tape");
const runtime = require("@observablehq/runtime");
const compiler = require("../dist/index");

test("compiler", async t => {
  const rt = new runtime.Runtime();
  const compile = new compiler.Compiler();
  const define = await compile.module(`
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

  const { redefine: aRedefine } = await compile.cell(`a = 10`);
  aRedefine(main);
  await rt._compute();
  t.equal(await main.value("a"), 10);
  t.equal(await main.value("c"), 12);

  const { define: xDefine } = await compile.cell(`x = y - 1`);
  xDefine(main, () => true);
  await rt._compute();

  try {
    await main.value("x");
    t.fail();
  } catch (error) {
    t.equal(error.constructor, runtime.RuntimeError);
  }

  const { define: yDefine } = await compile.cell(`y = 101`);
  yDefine(main, () => true);
  await rt._compute();

  t.equal(await main.value("y"), 101);
  t.equal(await main.value("x"), 100);

  const { redefine: eRedefine } = await compile.cell(`viewof e = {
    let output = {};
    let listeners = [];
    output.value = 20;
    output.addEventListener = (listener) => listeners.push(listener);;
    output.removeEventListener = (listener) => {
      listeners = listeners.filter(l => l !== listener);
    };
    return output;
  }`);
  eRedefine(main);
  await rt._compute();

  t.equal(await main.value("e"), 20);

  rt.dispose();
  t.end();
});
