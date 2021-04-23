import { parseCell, parseModule } from "@observablehq/parser";
import { setupRegularCell, setupImportCell, extractPath } from "./utils";
import { computeShakenCells } from "./tree-shake";

function ESMImports(moduleObject, resolveImportPath) {
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
}

function ESMAttachments(moduleObject, resolveFileAttachments) {
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
}

function ESMVariables(moduleObject, importMap, params) {
  const {
    defineImportMarkdown,
    observeViewofValues,
    observeMutableValues
  } = params;

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

        if (defineImportMarkdown)
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
  main.variable(${
    observeViewofValues ? `observer("${cellName}")` : `null`
  }).define("${cellName}", ["Generators", ${reference}], (G, _) => G.input(_));`;
        } else if (cell.id && cell.id.type === "MutableExpression") {
          const initialName = `"initial ${cellName}"`;
          const mutableName = `"mutable ${cellName}"`;
          src += `  main.define(${initialName}, ${cellReferencesString}${cellFunction});
  main.variable(observer(${mutableName})).define(${mutableName}, ["Mutable", ${initialName}], (M, _) => new M(_));
  main.variable(${
    observeMutableValues ? `observer("${cellName}")` : `null`
  }).define("${cellName}", [${mutableName}], _ => _.generator);`;
        } else {
          src += `  main.variable(observer(${cellNameString})).define(${
            cellName ? cellNameString + ", " : ""
          }${cellReferencesString}${cellFunction});`;
        }
      }
      return src;
    })
    .join("\n");
}
function createESModule(moduleObject, params = {}) {
  const {
    resolveImportPath,
    resolveFileAttachments,
    defineImportMarkdown,
    observeViewofValues,
    observeMutableValues
  } = params;
  const { importSrc, importMap } = ESMImports(moduleObject, resolveImportPath);
  return `${importSrc}export default function define(runtime, observer) {
  const main = runtime.module();
${ESMAttachments(moduleObject, resolveFileAttachments)}
${ESMVariables(moduleObject, importMap, {
  defineImportMarkdown,
  observeViewofValues,
  observeMutableValues
}) || ""}
  return main;
}`;
}

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
      resolveImportPath = defaultResolveImportPath,
      defineImportMarkdown = true,
      observeViewofValues = true,
      observeMutableValues = true
    } = params;
    this.resolveFileAttachments = resolveFileAttachments;
    this.resolveImportPath = resolveImportPath;
    this.defineImportMarkdown = defineImportMarkdown;
    this.observeViewofValues = observeViewofValues;
    this.observeMutableValues = observeMutableValues;
  }
  module(text, params = {}) {
    let m1 = parseModule(text);

    if (params.treeShake) m1 = computeShakenCells(m1, params.treeShake);

    return createESModule(m1, {
      resolveImportPath: this.resolveImportPath,
      resolveFileAttachments: this.resolveFileAttachments,
      defineImportMarkdown: this.defineImportMarkdown,
      observeViewofValues: this.observeViewofValues,
      observeMutableValues: this.observeMutableValues
    });
  }
  notebook(obj) {
    const cells = obj.nodes.map(({ value }) => {
      const cell = parseCell(value);
      cell.input = value;
      return cell;
    });
    return createESModule(
      { cells },
      {
        resolveImportPath: this.resolveImportPath,
        resolveFileAttachments: this.resolveFileAttachments,
        defineImportMarkdown: this.defineImportMarkdown,
        observeViewofValues: this.observeViewofValues,
        observeMutableValues: this.observeMutableValues
      }
    );
  }
}
