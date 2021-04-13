import { parseCell, parseModule, walk } from "@observablehq/parser";
import { simple } from "acorn-walk";
import { extractPath } from "./utils";

function setupImportCell(cell) {
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
}

function setupRegularCell(cell) {
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
}

function createRegularCellDefinition(cell) {
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
}

function defaultResolveImportPath(path) {
  const source = extractPath(path);
  return import(`https://api.observablehq.com/${source}.js?v=3`).then(
    m => m.default
  );
}

function defaultResolveFileAttachments(name) {
  return name;
}

export class Interpreter {
  constructor(params = {}) {
    const {
      module = null,
      observer = null,
      resolveImportPath = defaultResolveImportPath,
      resolveFileAttachments = defaultResolveFileAttachments,
      defineImportMarkdown = true,
      observeViewofValues = true
    } = params;

    // can't be this.module bc of async module().
    // so make defaultObserver follow same convention.
    this.defaultModule = module;
    this.defaultObserver = observer;

    this.resolveImportPath = resolveImportPath;
    this.resolveFileAttachments = resolveFileAttachments;
    this.defineImportMarkdown = defineImportMarkdown;
    this.observeViewofValues = observeViewofValues;
  }

  async module(input, module, observer) {
    module = module || this.defaultModule;
    observer = observer || this.defaultObserver;

    if (!module) throw Error("No module provided.");

    const parsedModule = parseModule(input);
    const cellPromises = [];
    for (const cell of parsedModule.cells) {
      cell.input = input;
      cellPromises.push(this.cell(cell, module, observer));
    }
    return Promise.all(cellPromises);
  }

  async cell(input, module, observer) {
    module = module || this.defaultModule;
    observer = observer || this.defaultObserver;

    if (!module) throw Error("No module provided.");

    let cell;
    if (typeof input === "string") {
      cell = parseCell(input);
      cell.input = input;
    } else {
      cell = input;
    }

    if (cell.body.type === "ImportDeclaration") {
      const path = cell.body.source.value;
      const fromModule = await this.resolveImportPath(path);
      let mdVariable, vars;

      const {
        specifiers,
        hasInjections,
        injections,
        importString
      } = setupImportCell(cell);

      const other = module._runtime.module(fromModule);

      if (this.defineImportMarkdown)
        mdVariable = module.variable(observer()).define(
          null,
          ["md"],
          md => md`~~~javascript
  ${importString}
  ~~~`
        );
      if (hasInjections) {
        const child = other.derive(injections, module);
        vars = specifiers.map(({ name, alias }) =>
          module.import(name, alias, child)
        );
      } else {
        vars = specifiers.map(({ name, alias }) =>
          module.import(name, alias, other)
        );
      }
      return mdVariable ? [mdVariable, ...vars] : vars;
    } else {
      const {
        cellName,
        cellFunction,
        cellReferences
      } = createRegularCellDefinition(cell);
      if (cell.id && cell.id.type === "ViewExpression") {
        const reference = `viewof ${cellName}`;
        return [
          module
            .variable(observer(reference))
            .define(reference, cellReferences, cellFunction),
          module
            .variable(this.observeViewofValues ? observer(cellName) : null)
            .define(cellName, ["Generators", reference], (G, _) => G.input(_))
        ];
      } else if (cell.id && cell.id.type === "MutableExpression") {
        const initialName = `initial ${cellName}`;
        const mutableName = `mutable ${cellName}`;
        return [
          module
            .variable(null)
            .define(initialName, cellReferences, cellFunction),
          module
            .variable(observer(mutableName))
            .define(mutableName, ["Mutable", initialName], (M, _) => new M(_)),
          module
            .variable(observer(cellName))
            .define(cellName, [mutableName], _ => _.generator)
        ];
      } else {
        return [
          module
            .variable(observer(cellName))
            .define(cellName, cellReferences, cellFunction)
        ];
      }
    }
  }
}
