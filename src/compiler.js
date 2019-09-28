import { parseCell, parseModule, walk } from "@observablehq/parser";
import { Library } from "@observablehq/runtime";
import { extractPath } from "./utils";
import { simple } from 'acorn-walk';

const { Generators, Mutable: constantMutable } = new Library();
const Mutable = constantMutable();

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
const createModuleDefintion = (m, resolveModule) => {
  return async function define(runtime, observer) {
    const { cells } = m;
    const main = runtime.module();

    const cellsPromise = cells.map(async cell => {
      if (cell.body.type === "ImportDeclaration") {
        const specifiers = (cell.body.specifiers || []).map(specifier => ({
          name: specifier.imported.name,
          alias: specifier.local.name
        }));
        const injections = (cell.body.injections || []).map(injection => ({
          name: injection.imported.name,
          alias: injection.local.name
        }));
        main.variable(observer()).define(
          null,
          ["md"],
          md => md`~~~javascript
    import {${specifiers.map(
      specifier => `${specifier.name} as ${specifier.alias}`
    )}}  ${
            injections.length > 0
              ? `with {${injections
                  .map(injection => `${injection.name} as ${injection.alias}`)
                  .join(",")}} `
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

        const other = runtime.module(from);
        const child = other.derive(injections, main);
        specifiers.map(specifier => {
          main.import(specifier.name, specifier.alias, child);
        });
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
          main.variable(observer(cellName)).define(cellName, [reference], Generators.input);
        } else if (cell.id && cell.id.type === "MutableExpression") {
          const initialName = `initial ${cellName}`;
          const mutableName = `mutable ${cellName}`;
          main
            .variable(null)
            .define(initialName, cellReferences, cellFunction);
          main.variable(observer(mutableName)).define(mutableName, [initialName], (_) => new Mutable(_));
          main.variable(observer(cellName)).define(cellName, [mutableName], _ => _.generator);
        } else {
          main
            .variable(observer(cellName))
            .define(cellName, cellReferences, cellFunction);
        }
      }
    });

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
}
