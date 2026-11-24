const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const string = value => typeof value === 'string';
const entity = value => object(value) && string(value.id) && /^[a-zA-Z0-9-]+$/.test(value.id);
const optional = (value, validate) => value == null || validate(value);
const list = (value, validate) => Array.isArray(value) && value.every(validate);
const named = value => entity(value) && string(value.name);
const finite = Number.isFinite;
const color = value => string(value) && /^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(value);

function richText(node, depth = 0) {
  return depth <= 100 && object(node) && string(node.type) &&
    optional(node.text, string) && optional(node.attrs, object) &&
    optional(node.marks, marks => list(marks, mark => object(mark) && string(mark.type) && optional(mark.attrs, object))) &&
    optional(node.content, content => list(content, child => richText(child, depth + 1)));
}

function document(value) {
  return entity(value) && string(value.title) && list(value.tags, string) &&
    optional(value.content, richText) &&
    optional(value.columns, columns => list(columns, named)) &&
    optional(value.rows, rows => list(rows, entity)) &&
    optional(value.board, board => object(board) &&
      list(board.notes, note => entity(note) && finite(note.x) && finite(note.y) && string(note.text) && color(note.color)) &&
      list(board.strokes, stroke => object(stroke) && color(stroke.color) &&
        list(stroke.points, point => Array.isArray(point) && point.length === 2 && point.every(finite))));
}

export function validWorkspace(workspace) {
  return object(workspace) && workspace.version === 1 &&
    list(workspace.spaces, named) && workspace.spaces.length > 0 &&
    list(workspace.folders, named) && list(workspace.docs, document) &&
    optional(workspace.settings, object) &&
    optional(workspace.reminders, reminders => list(reminders, reminder =>
      entity(reminder) && string(reminder.title) && finite(reminder.time)));
}
