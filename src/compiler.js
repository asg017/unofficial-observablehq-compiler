import { parseCell, parseModule, walk } from "@observablehq/parser";
import { simple } from "acorn-walk";
import { extractPath } from "./utils";

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

const ESMImports = (moduleObject, resolveImportPath) => {
  const importMap = new Map();
  let importSrc = "";
  let j = 0;

  for (const { body } of moduleObject.cells) {
    if (body.type !== "ImportDeclaration" || importMap.has(body.source.value))
      continue;

    const defineName = `define${++j}`;
    const fromPath = resolveImportPath(body.source.value);
    importMap.set(body.source.value, { defineName, fromPath });
    importSrc += `import ${defineName} from "${fromPath}";\n`;
  }

  if (importSrc.length) importSrc += "\n";
  return { importSrc, importMap };
};

const ESMAttachments = (moduleObject, resolveFileAttachments) => {
  const attachmentMapEntries = [];
  // loop over cells with fileAttachments
  for (const cell of moduleObject.cells) {
    if (cell.fileAttachments.size === 0) continue;
    // add filenames and resolved URLs to array
    for (const file of cell.fileAttachments.keys())
      attachmentMapEntries.push([file, resolveFileAttachments(file)]);
  }

  return attachmentMapEntries.length === 0
    ? ""
    : `  const fileAttachments = new Map(${JSON.stringify(
        attachmentMapEntries
      )});
  main.builtin("FileAttachment", runtime.fileAttachments(name => fileAttachments.get(name)));`;
};

const ESMVariables = (moduleObject, importMap) => {
  let childJ = 0;
  return moduleObject.cells
    .map(cell => {
      let src = "";

      if (cell.body.type === "ImportDeclaration") {
        const {
          specifiers,
          hasInjections,
          injections,
          importString
        } = setupImportCell(cell);
        // this will display extra names for viewof / mutable imports (for now?)
        src +=
          `  main.variable(observer()).define(
    null,
    ["md"],
    md => md\`~~~javascript
${importString}
~~~\`
  );` + "\n";
        // name imported notebook define functions
        const childName = `child${++childJ}`;
        src += `  const ${childName} = runtime.module(${
          importMap.get(cell.body.source.value).defineName
        })${
          hasInjections ? `.derive(${JSON.stringify(injections)}, main)` : ""
        };
${specifiers
  .map(
    specifier =>
      `  main.import("${specifier.name}", "${specifier.alias}", ${childName});`
  )
  .join("\n")}`;
      } else {
        const {
          cellName,
          references,
          bodyText,
          cellReferences
        } = setupRegularCell(cell);

        const cellNameString = cellName ? `"${cellName}"` : "";
        const referenceString = references.join(",");
        let code = "";
        if (cell.body.type !== "BlockStatement")
          code = `{return(
${bodyText}
)}`;
        else code = "\n" + bodyText + "\n";
        const cellReferencesString = cellReferences.length
          ? JSON.stringify(cellReferences) + ", "
          : "";
        let cellFunction = "";
        if (cell.generator && cell.async)
          cellFunction = `async function*(${referenceString})${code}`;
        else if (cell.async)
          cellFunction = `async function(${referenceString})${code}`;
        else if (cell.generator)
          cellFunction = `function*(${referenceString})${code}`;
        else cellFunction = `function(${referenceString})${code}`;

        if (cell.id && cell.id.type === "ViewExpression") {
          const reference = `"viewof ${cellName}"`;
          src += `  main.variable(observer(${reference})).define(${reference}, ${cellReferencesString}${cellFunction});
  main.variable(observer("${cellName}")).define("${cellName}", ["Generators", ${reference}], (G, _) => G.input(_));`;
        } else if (cell.id && cell.id.type === "MutableExpression") {
          const initialName = `"initial ${cellName}"`;
          const mutableName = `"mutable ${cellName}"`;
          src += `  main.define(${initialName}, ${cellReferencesString}${cellFunction});
  main.variable(observer(${mutableName})).define(${mutableName}, ["Mutable", ${initialName}], (M, _) => new M(_));
  main.variable(observer("${cellName}")).define("${cellName}", [${mutableName}], _ => _.generator);`;
        } else {
          src += `  main.variable(observer(${cellNameString})).define(${
            cellName ? cellNameString + ", " : ""
          }${cellReferencesString}${cellFunction});`;
        }
      }
      return src;
    })
    .join("\n");
};
const createESModule = (
  moduleObject,
  resolveImportPath,
  resolveFileAttachments
) => {
  const { importSrc, importMap } = ESMImports(moduleObject, resolveImportPath);
  return `${importSrc}export default function define(runtime, observer) {
  const main = runtime.module();
${ESMAttachments(moduleObject, resolveFileAttachments)}
${ESMVariables(moduleObject, importMap) || ""}
  return main;
}`;
};

function defaultResolveImportPath(path) {
  const source = extractPath(path);
  return `https://api.observablehq.com/${source}.js?v=3`;
}

function defaultResolveFileAttachments(name) {
  return name;
}
export class Compiler {
  constructor(params = {}) {
    const {
      resolveFileAttachments = defaultResolveFileAttachments,
      resolveImportPath = defaultResolveImportPath
    } = params;
    this.resolveFileAttachments = resolveFileAttachments;
    this.resolveImportPath = resolveImportPath;
  }
  module(text) {
    const m1 = parseModule(text);
    return createESModule(
      m1,
      this.resolveImportPath,
      this.resolveFileAttachments
    );
  }
  notebook(obj) {
    const cells = obj.nodes.map(({ value }) => {
      const cell = parseCell(value);
      cell.input = value;
      return cell;
    });
    return createESModule(
      { cells },
      this.resolveImportPath,
      this.resolveFileAttachments
    );
  }
}
