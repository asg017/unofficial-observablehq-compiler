import { parseCell, parseModule, walk } from "@observablehq/parser";
import { simple } from "acorn-walk";
import { extractPath } from "./utils";

const AsyncFunction = Object.getPrototypeOf(async function() {}).constructor;
const GeneratorFunction = Object.getPrototypeOf(function*() {}).constructor;
const AsyncGeneratorFunction = Object.getPrototypeOf(async function*() {})
  .constructor;

const setupRegularCell = cell => {
  let name = null;
  if (cell.id && cell.id.name) name = cell.id.name;
  else if (cell.id && cell.id.id && cell.id.id.name) name = cell.id.id.name;
  let bodyText = cell.input.substring(cell.body.start, cell.body.end);
  const cellReferences = (cell.references || []).map(ref => {
    if (ref.type === "ViewExpression") {
      return "viewof " + ref.id.name;
    } else if (ref.type === "MutableExpression") {
      return "mutable " + ref.id.name;
    } else return ref.name;
  });
  let $count = 0;
  let indexShift = 0;
  const references = (cell.references || []).map(ref => {
    if (ref.type === "ViewExpression") {
      const $string = "$" + $count;
      $count++;
      // replace "viewof X" in bodyText with "$($count)"
      simple(
        cell.body,
        {
          ViewExpression(node) {
            const start = node.start - cell.body.start;
            const end = node.end - cell.body.start;
            bodyText =
              bodyText.slice(0, start + indexShift) +
              $string +
              bodyText.slice(end + indexShift);
            indexShift += $string.length - (end - start);
          }
        },
        walk
      );
      return $string;
    } else if (ref.type === "MutableExpression") {
      const $string = "$" + $count;
      const $stringValue = $string + ".value";
      $count++;
      // replace "mutable Y" in bodyText with "$($count).value"
      simple(
        cell.body,
        {
          MutableExpression(node) {
            const start = node.start - cell.body.start;
            const end = node.end - cell.body.start;
            bodyText =
              bodyText.slice(0, start + indexShift) +
              $stringValue +
              bodyText.slice(end + indexShift);
            indexShift += $stringValue.length - (end - start);
          }
        },
        walk
      );
      return $string;
    } else return ref.name;
  });
  return { cellName: name, references, bodyText, cellReferences };
};

const createRegularCellDefintion = cell => {
  const { cellName, references, bodyText, cellReferences } = setupRegularCell(
    cell
  );

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
    cellName,
    cellFunction: f,
    cellReferences
  };
};

const setupImportCell = cell => {
  const specifiers = [];
  if (cell.body.specifiers)
    for (const specifier of cell.body.specifiers) {
      if (specifier.view) {
        specifiers.push({
          name: "viewof " + specifier.imported.name,
          alias: "viewof " + specifier.local.name
        });
      } else if (specifier.mutable) {
        specifiers.push({
          name: "mutable " + specifier.imported.name,
          alias: "mutable " + specifier.local.name
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
  if (hasInjections)
    for (const injection of cell.body.injections) {
      // This currently behaves like notebooks on observablehq.com
      // Commenting out the if & else if blocks result in behavior like Example 3 here: https://observablehq.com/d/7ccad009e4d89969
      if (injection.view) {
        injections.push({
          name: "viewof " + injection.imported.name,
          alias: "viewof " + injection.local.name
        });
      } else if (injection.mutable) {
        injections.push({
          name: "mutable " + injection.imported.name,
          alias: "mutable " + injection.local.name
        });
      }
      injections.push({
        name: injection.imported.name,
        alias: injection.local.name
      });
    }
  const importString = `import {${specifiers
    .map(specifier => `${specifier.name} as ${specifier.alias}`)
    .join(", ")}} ${
    hasInjections
      ? `with {${injections
          .map(injection => `${injection.name} as ${injection.alias}`)
          .join(", ")}} `
      : ``
  }from "${cell.body.source.value}"`;

  return { specifiers, hasInjections, injections, importString };
};

const createCellDefinition = (
  cell,
  main,
  observer,
  dependencyMap,
  define = true
) => {
  if (cell.body.type === "ImportDeclaration") {
    const {
      specifiers,
      hasInjections,
      injections,
      importString
    } = setupImportCell(cell);
    // this will display extra names for viewof / mutable imports (for now?)
    main.variable(observer()).define(
      null,
      ["md"],
      md => md`~~~javascript
${importString}
~~~`
    );

    const other = main._runtime.module(
      dependencyMap.get(cell.body.source.value)
    );

    if (hasInjections) {
      const child = other.derive(injections, main);
      for (const { name, alias } of specifiers) main.import(name, alias, child);
    } else {
      for (const { name, alias } of specifiers) main.import(name, alias, other);
    }
  } else {
    const {
      cellName,
      cellFunction,
      cellReferences
    } = createRegularCellDefintion(cell);
    if (cell.id && cell.id.type === "ViewExpression") {
      const reference = `viewof ${cellName}`;
      if (define) {
        main
          .variable(observer(reference))
          .define(reference, cellReferences, cellFunction);
        main
          .variable(observer(cellName))
          .define(cellName, ["Generators", reference], (G, _) => G.input(_));
      } else {
        main.redefine(reference, cellReferences, cellFunction);
        main.redefine(cellName, ["Generators", reference], (G, _) =>
          G.input(_)
        );
      }
    } else if (cell.id && cell.id.type === "MutableExpression") {
      const initialName = `initial ${cellName}`;
      const mutableName = `mutable ${cellName}`;
      if (define) {
        main.variable(null).define(initialName, cellReferences, cellFunction);
        main
          .variable(observer(mutableName))
          .define(mutableName, ["Mutable", initialName], (M, _) => new M(_));
        main
          .variable(observer(cellName))
          .define(cellName, [mutableName], _ => _.generator);
      } else {
        main.redefine(initialName, cellReferences, cellFunction);
        main.redefine(
          mutableName,
          ["Mutable", initialName],
          (M, _) => new M(_)
        );
        main.redefine(cellName, [mutableName], _ => _.generator);
      }
    } else {
      if (define)
        main
          .variable(observer(cellName))
          .define(cellName, cellReferences, cellFunction);
      else main.redefine(cellName, cellReferences, cellFunction);
    }
  }
};
const createModuleDefintion = async (
  moduleObject,
  resolveModule,
  resolveFileAttachments
) => {
  const filteredImportCells = new Set();
  const importCells = moduleObject.cells.filter(({ body }) => {
    if (
      body.type !== "ImportDeclaration" ||
      filteredImportCells.has(body.source.value)
    )
      return false;
    filteredImportCells.add(cell.body.source.value);
  });

  const dependencyMap = new Map();
  const importCellsPromise = importCells.map(async ({ body }) => {
    const fromModule = await resolveModule(body.source.value);
    dependencyMap.set(body.source.value, fromModule);
  });
  await Promise.all(importCellsPromise);

  return function define(runtime, observer) {
    const main = runtime.module();
    main.builtin(
      "FileAttachment",
      runtime.fileAttachments(resolveFileAttachments)
    );
    for (const cell of moduleObject.cells)
      createCellDefinition(cell, main, observer, dependencyMap);
  };
};

const defaultResolver = async path => {
  const source = extractPath(path);
  return import(`https://api.observablehq.com/${source}.js?v=3`).then(
    m => m.default
  );
};

export class Compiler {
  constructor(
    resolve = defaultResolver,
    resolveFileAttachments = name => name
  ) {
    this.resolve = resolve;
    this.resolveFileAttachments = resolveFileAttachments;
  }
  async cell(text) {
    const cell = parseCell(text);
    cell.input = text;
    const dependencyMap = new Map();
    if (cell.body.type === "ImportDeclaration") {
      const fromModule = await this.resolve(cell.body.source.value);
      dependencyMap.set(cell.body.source.value, fromModule);
    }
    return {
      define(module, observer) {
        createCellDefinition(cell, module, observer, dependencyMap, true);
      },
      redefine(module, observer) {
        createCellDefinition(cell, module, observer, dependencyMap, false);
      }
    };
  }

  async module(text) {
    const m1 = parseModule(text);
    return await createModuleDefintion(
      m1,
      this.resolve,
      this.resolveFileAttachments
    );
  }
  async notebook(obj) {
    const cells = obj.nodes.map(({ value }) => {
      const cell = parseCell(value);
      cell.input = value;
      return cell;
    });
    return await createModuleDefintion(
      { cells },
      this.resolve,
      this.resolveFileAttachments
    );
  }
}
