function names(cell) {
  if (cell.body && cell.body.specifiers)
    return cell.body.specifiers.map(
      d => `${d.view ? "viewof " : d.mutable ? "mutable " : ""}${d.local.name}`
    );

  if (cell.id && cell.id.type && cell.id) {
    if (cell.id.type === "ViewExpression") return [`viewof ${cell.id.id.name}`];
    if (cell.id.type === "MutableExpression")
      return [`mutable ${cell.id.id.name}`];
    if (cell.id.name) return [cell.id.name];
  }

  return [];
}

function references(cell, stdlibCells) {
  if (cell.references)
    return cell.references
      .map(d => {
        if (d.name) return d.name;
        if (d.type === "ViewExpression") return `viewof ${d.id.name}`;
        if (d.type === "MutableExpression") return `mutable ${d.id.name}`;
        return null;
      })
      .filter(d => !stdlibCells.has(d));

  if (cell.body && cell.body.injections)
    return cell.body.injections
      .map(
        d =>
          `${d.view ? "viewof " : d.mutable ? "mutable " : ""}${
            d.imported.name
          }`
      )
      .filter(d => !stdlibCells.has(d));

  return [];
}

function getCellRefs(module, stdlibCells) {
  const cells = [];
  for (const cell of module.cells) {
    const ns = names(cell);
    const refs = references(cell, stdlibCells);
    if (!ns || !ns.length) continue;
    for (const name of ns) {
      cells.push([name, refs]);
      if (name.startsWith("viewof "))
        cells.push([name.substring("viewof ".length), [name]]);
    }
  }
  return new Map(cells);
}

export function computeShakenCells(module, targets, stdlibCells) {
  const cellRefs = getCellRefs(module, stdlibCells);

  const embed = new Set();
  const todo = targets.slice();
  while (todo.length) {
    const d = todo.pop();
    embed.add(d);
    if (!cellRefs.has(d)) throw Error(`${d} not a defined cell in module`);
    const refs = cellRefs.get(d);
    for (const ref of refs) if (!embed.has(ref)) todo.push(ref);
  }
  return {
    cells: module.cells.filter(
      cell => names(cell).filter(name => embed.has(name)).length
    )
  };
}
