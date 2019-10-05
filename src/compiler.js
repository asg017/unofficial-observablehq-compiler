import { parseCell, parseModule, walk } from "@observablehq/parser";
import { extractPath } from "./utils";
import { simple } from 'acorn-walk';

const AsyncFunction = Object.getPrototypeOf(async function() {}).constructor;
const GeneratorFunction = Object.getPrototypeOf(function*() {}).constructor;
const AsyncGeneratorFunction = Object.getPrototypeOf(async function*() {})
  .constructor;

const createImportCellDefintion = async (cell, resolveModule) => {
  const source = cell.body.source.value;
  const from = await resolveModule(source);
  return { from };
};
const createRegularCellDefintion = cell => {
  let name = null;
  if (cell.id && cell.id.name) name = cell.id.name;
  else if (cell.id && cell.id.id && cell.id.id.name) name = cell.id.id.name;
  let bodyText = cell.input.substring(cell.body.start, cell.body.end);
  const cellReferences = (cell.references || []).map(ref => {
    if (ref.type === "ViewExpression") {
      return 'viewof ' + ref.id.name;
    } else if (ref.type === "MutableExpression") {
      return 'mutable ' + ref.id.name;
    } else return ref.name;
  });
  let $count = 0;
  let indexShift = 0;
  const references = (cell.references || []).map(ref => {
    if (ref.type === "ViewExpression") {
      const $string = '$' + $count;
      $count++;
      // replace "viewof X" in bodyText with "$($count)"
      simple(cell.body, {
        ViewExpression(node) {
          const start = node.start - cell.body.start;
          const end = node.end - cell.body.start;
          bodyText = bodyText.slice(0, start + indexShift) + $string + bodyText.slice(end + indexShift);
          indexShift += $string.length - (end - start);
        }
      }, walk);
      return $string;
    } else if (ref.type === "MutableExpression") {
      const $string = '$' + $count;
      const $stringValue = $string + '.value';
      $count++;
      // replace "mutable Y" in bodyText with "$($count).value"
      simple(cell.body, {
        MutableExpression(node) {
          const start = node.start - cell.body.start;
          const end = node.end - cell.body.start;
          bodyText = bodyText.slice(0, start + indexShift) + $stringValue + bodyText.slice(end + indexShift);
          indexShift += $stringValue.length - (end - start);
        }
      }, walk);
      return $string;
    } else return ref.name;
  });
  let code;
  if (cell.body.type !== "BlockStatement") {
    if (cell.async)
      code = `return (async function(){ return (${bodyText});})()`;
    else code = `return (function(){ return (${bodyText});})()`;
  } else code = bodyText;

  let f;

  if (cell.generator && cell.async)
    f = new AsyncGeneratorFunction(...references, code);
  else if (cell.async) f = new AsyncFunction(...references, code);
  else if (cell.generator) f = new GeneratorFunction(...references, code);
  else f = new Function(...references, code);
  return {
    cellName: name,
    cellFunction: f,
    cellReferences
  };
};
const cellPromise = async (cell, main, observer, resolveModule) => {
  if (cell.body.type === "ImportDeclaration") {
    const specifiers = [];
    if (cell.body.specifiers) for (const specifier of cell.body.specifiers) {
      if (specifier.view) {
        specifiers.push({
          name: 'viewof ' + specifier.imported.name,
          alias: 'viewof ' + specifier.local.name
        });
      } else if (specifier.mutable) {
        specifiers.push({
          name: 'mutable ' + specifier.imported.name,
          alias: 'mutable ' + specifier.local.name
        });
      }
      specifiers.push({
        name: specifier.imported.name,
        alias: specifier.local.name
      });
    }
    // If injections is undefined, do not derive!
    const hasInjections = cell.body.injections !== undefined;
    const injections = [];
    if (hasInjections) for (const injection of cell.body.injections) {
      // This currently behaves like notebooks on observablehq.com
      // Commenting out the if & else if blocks result in behavior like Example 3 here: https://observablehq.com/d/7ccad009e4d89969
      if (injection.view) {
        injections.push({
          name: 'viewof ' + injection.imported.name,
          alias: 'viewof ' + injection.local.name
        });
      } else if (injection.mutable) {
        injections.push({
          name: 'mutable ' + injection.imported.name,
          alias: 'mutable ' + injection.local.name
        });
      }
      injections.push({
        name: injection.imported.name,
        alias: injection.local.name
      });
    }
    // this will display extra names for viewof / mutable imports (for now?)
    main.variable(observer()).define(
      null,
      ["md"],
      md => md`~~~javascript
import {${specifiers.map(
  specifier => `${specifier.name} as ${specifier.alias}`
).join(', ')}}  ${
        hasInjections
          ? `with {${injections
              .map(injection => `${injection.name} as ${injection.alias}`)
              .join(", ")}} `
          : ``
      }from "${cell.body.source.value}"
~~~`
    );
    const { from } = await createImportCellDefintion(
      cell,
      resolveModule
    ).catch(err => {
      throw Error("Error defining import cell", err);
    });

    const other = main._runtime.module(from);
    if (hasInjections) {
      const child = other.derive(injections, main);
      specifiers.map(specifier => {
        main.import(specifier.name, specifier.alias, child);
      });
    } else {
      specifiers.map(specifier => {
        main.import(specifier.name, specifier.alias, other);
      });
    }
  } else {
    const {
      cellName,
      cellFunction,
      cellReferences
    } = createRegularCellDefintion(cell);
    if (cell.id && cell.id.type === "ViewExpression") {
      const reference = `viewof ${cellName}`;
      main
        .variable(observer(reference))
        .define(reference, cellReferences, cellFunction);
      main.variable(observer(cellName)).define(cellName, ["Generators", reference], (G, _) => G.input(_));
    } else if (cell.id && cell.id.type === "MutableExpression") {
      const initialName = `initial ${cellName}`;
      const mutableName = `mutable ${cellName}`;
      main
        .variable(null)
        .define(initialName, cellReferences, cellFunction);
      main.variable(observer(mutableName)).define(mutableName, ["Mutable", initialName], (M, _) => new M(_));
      main.variable(observer(cellName)).define(cellName, [mutableName], _ => _.generator);
    } else {
      main
        .variable(observer(cellName))
        .define(cellName, cellReferences, cellFunction);
    }
  }
};
const createModuleDefintion = (m, resolveModule) => {
  return async function define(runtime, observer) {
    const { cells } = m;
    const main = runtime.module();

    const cellsPromise = cells.map(async cell => cellPromise(cell, main, observer, resolveModule));

    await Promise.all(cellsPromise);
  };
};

const defaultResolver = async path => {
  const source = extractPath(path);
  return import(`https://api.observablehq.com/${source}.js?v=3`).then(
    m => m.default
  );
};

export class Compiler {
  constructor(resolve = defaultResolver) {
    this.resolve = resolve;
  }
  cell(text) {
    throw Error(`compile.cell not implemented yet`);
  }
  module(text) {
    const m1 = parseModule(text);
    return createModuleDefintion(m1, this.resolve);
  }
  notebook(obj) {
    const cells = obj.nodes.map(({value}) => {
      const cell = parseCell(value);
      cell.input = value;
      return cell;
    });
    const resolve = this.resolve;
    return async function define(runtime, observer) {
      const main = runtime.module();

      const cellsPromise = cells.map(async cell => cellPromise(cell, main, observer, resolve));

      await Promise.all(cellsPromise);
    };
  }
}
