/* CSV cells are untrusted when opened in spreadsheet programs. Quoting alone
 * does not stop formula evaluation in Excel/LibreOffice/Sheets. */
export function safeCsvCell(value) {
  let text = String(value ?? '');
  if (/^[\s\uFEFF\u200B]*[=+\-@]/u.test(text) || /^[\t\r\n]/u.test(text)) {
    text = "'" + text;
  }
  return '"' + text.replaceAll('"', '""') + '"';
}
