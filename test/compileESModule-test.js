const test = require("tape");
const compiler = require("../dist/index");

test("ES module: simple", async t => {
  const compile = new compiler.Compiler();
  const src = compile.moduleToESModule(`
a = 1

b = 2

c = a + b

d = {
  yield 1;
  yield 2;
  yield 3;
}

{
  await d;
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
  t.equal(src, `export default function define(runtime, observer) {
  const main = runtime.module();

  main.variable(observer("a")).define("a", function(){return(
1
)});
  main.variable(observer("b")).define("b", function(){return(
2
)});
  main.variable(observer("c")).define("c", ["a","b"], function(a,b){return(
a + b
)});
  main.variable(observer("d")).define("d", function*()
{
  yield 1;
  yield 2;
  yield 3;
}
);
  main.variable(observer()).define(["d"], async function(d)
{
  await d;
}
);
  main.variable(observer("viewof e")).define("viewof e", function()
{
  let output = {};
  let listeners = [];
  output.value = 10;
  output.addEventListener = (listener) => listeners.push(listener);;
  output.removeEventListener = (listener) => {
    listeners = listeners.filter(l => l !== listener);
  };
  return output;
}
);
  main.variable(observer("e")).define("e", ["Generators", "viewof e"], (G, _) => G.input(_));
  return main;
}`);

  t.end();
});

test("ES module: imports", async t => {
  const compile = new compiler.Compiler();
  const src = compile.moduleToESModule(`import {a} from "b"
b = {
  return 3*a
}
import {c as bc} from "b"
import {d} with {b as cb} from "c"
`);

  t.equal(src, `import define1 from "https://api.observablehq.com/b.js?v=3";
import define2 from "https://api.observablehq.com/c.js?v=3";

export default function define(runtime, observer) {
  const main = runtime.module();

  main.variable(observer()).define(
    null,
    ["md"],
    md => md\`~~~javascript
import {a as a} from "b"
~~~\`
  );
  const child1 = runtime.module(define1);
  main.import("a", "a", child1);
  main.variable(observer("b")).define("b", ["a"], function(a)
{
  return 3*a
}
);
  main.variable(observer()).define(
    null,
    ["md"],
    md => md\`~~~javascript
import {c as bc} from "b"
~~~\`
  );
  const child2 = runtime.module(define1);
  main.import("c", "bc", child2);
  main.variable(observer()).define(
    null,
    ["md"],
    md => md\`~~~javascript
import {d as d} with {b as cb} from "c"
~~~\`
  );
  const child3 = runtime.module(define2).derive([{"name":"b","alias":"cb"}], main);
  main.import("d", "d", child3);
  return main;
}`);

  t.end();
});


test("ES module: custom resolvePath function", async t => {
  const resolvePath = name => `https://gist.github.com/${name}`;
  const compile = new compiler.Compiler(undefined, undefined, resolvePath);
  const src = compile.moduleToESModule(`import {a} from "b"
b = {
  return 3*a
}
import {c as bc} from "b"
import {d} with {b as cb} from "c"
`);

  t.equal(src, `import define1 from "https://gist.github.com/b";
import define2 from "https://gist.github.com/c";

export default function define(runtime, observer) {
  const main = runtime.module();

  main.variable(observer()).define(
    null,
    ["md"],
    md => md\`~~~javascript
import {a as a} from "b"
~~~\`
  );
  const child1 = runtime.module(define1);
  main.import("a", "a", child1);
  main.variable(observer("b")).define("b", ["a"], function(a)
{
  return 3*a
}
);
  main.variable(observer()).define(
    null,
    ["md"],
    md => md\`~~~javascript
import {c as bc} from "b"
~~~\`
  );
  const child2 = runtime.module(define1);
  main.import("c", "bc", child2);
  main.variable(observer()).define(
    null,
    ["md"],
    md => md\`~~~javascript
import {d as d} with {b as cb} from "c"
~~~\`
  );
  const child3 = runtime.module(define2).derive([{"name":"b","alias":"cb"}], main);
  main.import("d", "d", child3);
  return main;
}`);

  t.end();
});

test("ES module: viewof + mutable", async t => {
  const compile = new compiler.Compiler();
  const src = compile.moduleToESModule(`viewof a = {
  const div = html\`\`;
  div.value = 3;
  return div;
}
mutable b = 3
{
  return b*b
}
d = {
  mutable b++;
  return a + b;
}
import {viewof v as w, mutable m} from "notebook"`);

  t.equal(src, `import define1 from "https://api.observablehq.com/notebook.js?v=3";

export default function define(runtime, observer) {
  const main = runtime.module();

  main.variable(observer("viewof a")).define("viewof a", ["html"], function(html)
{
  const div = html\`\`;
  div.value = 3;
  return div;
}
);
  main.variable(observer("a")).define("a", ["Generators", "viewof a"], (G, _) => G.input(_));
  main.define("initial b", function(){return(
3
)});
  main.variable(observer("mutable b")).define("mutable b", ["Mutable", "initial b"], (M, _) => new M(_));
  main.variable(observer("b")).define("b", ["mutable b"], _ => _.generator);
  main.variable(observer()).define(["b"], function(b)
{
  return b*b
}
);
  main.variable(observer("d")).define("d", ["mutable b","a","b"], function($0,a,b)
{
  $0.value++;
  return a + b;
}
);
  main.variable(observer()).define(
    null,
    ["md"],
    md => md\`~~~javascript
import {viewof v as viewof w, v as w, mutable m as mutable m, m as m} from "notebook"
~~~\`
  );
  const child1 = runtime.module(define1);
  main.import("viewof v", "viewof w", child1);
  main.import("v", "w", child1);
  main.import("mutable m", "mutable m", child1);
  main.import("m", "m", child1);
  return main;
}`);

  t.end();
});

test("ES module: FileAttachment", async t => {
  const compile = new compiler.Compiler();
  const src = compile.moduleToESModule(`md\`Here's a cell with a file attachment! <img src="\${await FileAttachment("image.png").url()}">\``);

  t.equal(src, `export default function define(runtime, observer) {
  const main = runtime.module();
  const fileAttachments = new Map([["image.png","image.png"]]);
  main.builtin("FileAttachment", runtime.fileAttachments(name => fileAttachments.get(name)));
  main.variable(observer()).define(["md","FileAttachment"], async function(md,FileAttachment){return(
md\`Here's a cell with a file attachment! <img src="\${await FileAttachment("image.png").url()}">\`
)});
  return main;
}`);

  t.end();
});

test("ES module: custom fileAttachmentsResolve", async t => {
  const fileAttachmentsResolve = name => `https://example.com/${name}`;
  const compile = new compiler.Compiler(undefined, fileAttachmentsResolve);
  const src = compile.moduleToESModule(`md\`Here's a cell with a file attachment! <img src="\${await FileAttachment("image.png").url()}">\``);

  t.equal(src, `export default function define(runtime, observer) {
  const main = runtime.module();
  const fileAttachments = new Map([["image.png","https://example.com/image.png"]]);
  main.builtin("FileAttachment", runtime.fileAttachments(name => fileAttachments.get(name)));
  main.variable(observer()).define(["md","FileAttachment"], async function(md,FileAttachment){return(
md\`Here's a cell with a file attachment! <img src="\${await FileAttachment("image.png").url()}">\`
)});
  return main;
}`);

  t.end();
});


