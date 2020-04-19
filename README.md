# @alex.garcia/unofficial-observablehq-compiler [![CircleCI](https://circleci.com/gh/asg017/unofficial-observablehq-compiler.svg?style=svg)](https://circleci.com/gh/asg017/unofficial-observablehq-compiler)

An unoffical compiler for Observable notebooks (glue between the Observable parser and runtime)

This compiler will compile "observable syntax" into "javascript syntax".
For example -

```javascript
import compiler from "@alex.garcia/unofficial-observablehq-compiler";
import { Inspector, Runtime } from "@observablehq/runtime";

const compile = new compiler.Compiler();

compile.module(`
import {text} from '@jashkenas/inputs'

viewof name = text({
  title: "what's your name?",
  value: ''
})

md\`Hello **\${name}**, it's nice to meet you!\`

`).then(define => {
  const runtime = new Runtime();

  const module = runtime.module(define, Inpsector.into(document.body));
});
```

For more live examples and functionality, take a look at the [announcement notebook](https://observablehq.com/d/74f872c4fde62e35)
and this [test page](https://github.com/asg017/unofficial-observablehq-compiler/blob/master/test/test.html).

## API Reference

### Compiler

<a href="#Compiler" name="Compiler">#</a> new <b>Compiler</b>(<i>resolve</i> = defaultResolver, <i>fileAttachmentsResolve</i> = name => name, <i>resolvePath</i> = defaultResolvePath) [<>](https://github.com/asg017/unofficial-observablehq-compiler/blob/master/src/compiler.js#L119 "Source")

Returns a new compiler. `resolve` is an optional function that, given a `path`
string, will resolve a new define function for a new module. This is used when
the compiler comes across an import statement - for example:

```javascript
import {chart} from "@d3/bar-chart"
```

In this case, `resolve` gets called with `path="@d3/bar-chart"`. The `defaultResolver`
function will lookup the given path on observablehq.com and return the define
function to define that notebook.

For example, if you have your own set of notebooks on some other server, you
could use something like:

```javascript
const resolve = path =>
  import(`other.server.com/notebooks/${path}.js`).then(
    module => module.default
  );

const compile = new Compiler(resolve);
```

`fileAttachmentsResolve` is an optional function from strings to URLs which is used as a <i>resolve</i> function in the standard library's <a href="https://github.com/observablehq/stdlib#FileAttachments">FileAttachments</a> function. For example, if you wanted to reference `example.com/my_file.png` in a cell which reads:

```javascript
await FileAttachment("my_file.png").url();
```

Then you could compile this cell with:

```javascript
const fileAttachmentsResolve = name => `example.com/${name}`;

const compile = new Compiler(, fileAttachmentsResolve);
```

By default, `fileAtachmentsResolve` simply returns the same string, so you would have to use valid absolute or relative URLs in your `FileAttachment`s.

`resolvePath` is an optional function from strings to URLs which is used to turn the strings in `import` cells to URLs in [`compile.moduleToESModule`](#compile_moduleToESModule) and  [`compile.notebookToESModule`](#compile_notebookToESModule). For instance, if those functions encounter this cell:
```javascript
import {chart} from "@d3/bar-chart"
```
then `resolvePath` is called with `path="@d3/bar-chart"` and the resulting URL is included in the static `import` statements at the beginning of the generated ES module source.

<a href="#compile_module" name="compile_module">#</a>compile.<b>module</b>(<i>contents</i>)

Returns a define function. `contents` is a string that defines a "module", which
is a list of "cells" (both defintions from [@observablehq/parser](https://github.com/observablehq/parser)).
It must be compatible with [`parseModule`](https://github.com/observablehq/parser#parseModule). This fetches all imports so it is asynchronous.

For example:

```javascript
const define = await compile.module(`a = 1
b = 2
c = a + b`);
```

You can now use `define` with the Observable [runtime](https://github.com/observablehq/runtime):

```javascript
const runtime = new Runtime();
const main = runtime.module(define, Inspector.into(document.body));
```

<a href="#compile_notebook" name="compile_notebook">#</a>compile.<b>notebook</b>(<i>object</i>)

Returns a define function. `object` is a "notebook JSON object" as used by the
ObservableHQ notebook app to display notebooks. Such JSON files are served by
the API endpoint at `https://api.observablehq.com/document/:slug` (see the
[`observable-client`](https://github.com/mootari/observable-client) for a
convenient way to authenticate and make requests).

`compile.notebook` requires that `object` has a field named `"nodes"`
consisting of an array of cell objects. Each of the cell objects must have a
field `"value"` consisting of a string with the source code for that cell.

The notebook JSON objects also ordinarily contain some other metadata fields,
e.g. `"id"`, `"slug"`, `"owner"`, etc. which are currently ignored by the
compiler. Similarly, the cell objects in `"nodes"` ordinarily contain `"id"` and
`"pinned"` fields which are also unused here.

This fetches all imports so it is asynchronous.

For example:

```javascript
const define = await compile.notebook({
  nodes: [{ value: "a = 1" }, { value: "b = 2" }, { value: "c = a + b" }]
});
```

You can now use `define` with the Observable [runtime](https://github.com/observablehq/runtime):

```javascript
const runtime = new Runtime();
const main = runtime.module(define, Inspector.into(document.body));
```

<a href="#compile_cell" name="compile_cell">#</a>compile.<b>cell</b>(<i>contents</i>)

Returns an object that has `define` and `redefine` functions that would define or redefine variables in the given cell to a specified module. `contents` is input for the [`parseCell`](https://github.com/observablehq/parser#parseCell) function. If the cell is not an ImportDeclaration, then the `redefine` functions can be used to redefine previously existing variables in a module. This is an asynchronous function because if the cell is an import, the imported notebook is fetched.

```javascript
let define, redefine;

define = await compile.module(`a = 1;
b = 2;

c = a + b`);

const runtime = new Runtime();
const main = runtime.module(define, Inspector.into(document.body));

await main.value("a") // 1

{define, redefine} = await compile.cell(`a = 20`);

redefine(main);

await main.value("a"); // 20
await main.value("c"); // 22

define(main); // would throw an error, since a is already defined in main

{define} = await compile.cell(`x = 2`);
define(main);
{define} = await compile.cell(`y = x * 4`);
define(main);

await main.value("y") // 8

```

Keep in mind, if you want to use `define` from `compile.cell`, you'll have to provide an `observer` function, which will most likely be the same observer that was used when defining the module. For example:

```javascript

let define, redefine;

define = await compile.module(`a = 1;
b = 2;`);

const runtime = new Runtime();
const observer = Inspector.into(document.body);
const main = runtime.module(define, observer);

{define} = await compile.cell(`c = a + b`);

define(main, observer);

```

Since `redefine` is done on a module level, an observer is not required.

<a href="#compile_notebook" name="compile_notebook">#</a>compile.<b>moduleToESModule</b>(<i>contents</i>)

Returns a string containing the source code of an ES module. This ES module is compiled from the Observable runtime module in the string `contents`.

For example:

```javascript
const src = compile.moduleToESModule(`a = 1
b = 2
c = a + b`);
```

Now `src` contains the following:

```javascript
export default function define(runtime, observer) {
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
  return main;
}
```

<a href="#compile_notebook" name="compile_notebook">#</a>compile.<b>notebookToESModule</b>(<i>object</i>)

Returns a string containing the source code of an ES module. This ES module is compiled from the Observable runtime module in the notebok object `object`. (See [compile.notebook](#compile_notebook)).

For example:

```javascript
const src = compile.notebookToESModule({
  nodes: [{ value: "a = 1" }, { value: "b = 2" }, { value: "c = a + b" }]
});
```

Now `src` contains the following:

```javascript
export default function define(runtime, observer) {
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
  return main;
}
```

## License

This library is MIT, but it relies and gets heavy inspiration from the following
libraries licensed under ISC:

- [@observablehq/runtime](https://github.com/observablehq/runtime)
- [@observablehq/stdlib](https://github.com/observablehq/stdlib)
- [@observablehq/inspector](https://github.com/observablehq/inspector)
- [@observablehq/parser](https://github.com/observablehq/parser)

## Contributing

Feel free to send in PR's as you wish! Take a look at the [issues](https://github.com/asg017/unofficial-observablehq-compiler/issues)
to find something to work on. Just please follow the [Contributor Covenant](https://www.contributor-covenant.org/)
in all your interactions :smile:
