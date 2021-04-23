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
  const xDefineVars = xDefine(main, () => true);
  t.equal(xDefineVars.length, 1); //check length
  t.equal(xDefineVars[0]._name, "x"); //check name
  await rt._compute();

  try {
    await main.value("x");
    t.fail();
  } catch (error) {
    t.equal(error.constructor, runtime.RuntimeError);
  }

  const { define: yDefine } = await compile.cell(`y = 101`);
  const yDefineVars = yDefine(main, () => true);
  t.equal(yDefineVars.length, 1); //check length
  t.equal(yDefineVars[0]._name, "y"); //check name

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

  const { define: fDefine } = await compile.cell(`viewof f = {
    let output = {};
    let listeners = [];
    output.value = 20;
    output.addEventListener = (listener) => listeners.push(listener);;
    output.removeEventListener = (listener) => {
      listeners = listeners.filter(l => l !== listener);
    };
    return output;
  }`);
  const fDefineVars = fDefine(main, () => true);
  t.equal(fDefineVars.length, 2); //check length
  t.equal(fDefineVars[0]._name, "viewof f"); //check name
  t.equal(fDefineVars[1]._name, "f"); //check name
  await rt._compute();

  t.equal(await main.value("f"), 20);

  const { define: gDefine } = await compile.cell(`mutable g = 123`);
  const gDefineVars = gDefine(main, () => true);
  t.equal(gDefineVars.length, 3); //check length
  t.equal(gDefineVars[0]._name, "initial g"); //check name
  t.equal(gDefineVars[1]._name, "mutable g"); //check name
  t.equal(gDefineVars[2]._name, "g"); //check name
  await rt._compute();

  t.equal(await main.value("g"), 123);

  rt.dispose();
  t.end();
});
