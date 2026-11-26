import * as cfb from 'cfb';
import { validateDossierFile } from './dossier-file-validation';

const docx = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const xlsx = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const office = (mainPart: string, contents: string, fileType: 'zip' | 'cfb') => {
  const container = cfb.utils.cfb_new();
  if (fileType === 'zip') {
    cfb.utils.cfb_add(container, '[Content_Types].xml', Buffer.from('<Types/>'));
    cfb.utils.cfb_add(container, '_rels/.rels', Buffer.from('<Relationships/>'));
  }
  cfb.utils.cfb_add(container, mainPart, Buffer.from(contents));
  return cfb.write(container, { type: 'buffer', fileType, compression: true }) as Buffer;
};

it('validates Word and Excel containers against their own internal format', async () => {
  const word = office('word/document.xml', '<w:document />', 'zip');
  const excel = office('xl/workbook.xml', '<workbook/>', 'zip');
  const wrongXml = office('word/document.xml', '<workbook/>', 'zip');
  await expect(validateDossierFile('A.docx', docx, word)).resolves.toBe(docx);
  await expect(validateDossierFile('A.xlsx', xlsx, excel)).resolves.toBe(xlsx);
  await expect(validateDossierFile('A.xlsx', xlsx, word)).rejects.toThrow('invalid');
  await expect(validateDossierFile('A.docx', docx, wrongXml)).rejects.toThrow('invalid');
  const document = office('WordDocument', 'binary fixture', 'cfb');
  const workbook = office('Workbook', 'binary fixture', 'cfb');
  await expect(validateDossierFile('A.doc', 'application/msword', document)).resolves.toBe('application/msword');
  await expect(validateDossierFile('A.xls', 'application/vnd.ms-excel', workbook)).resolves.toBe('application/vnd.ms-excel');
  await expect(validateDossierFile('A.doc', 'application/msword', workbook)).rejects.toThrow('invalid');
});

it('checks allowlisted extensions and server-detected signatures even when MIME is generic', async () => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+iQWQAAAAASUVORK5CYII=', 'base64');
  await expect(validateDossierFile('report.PNG', 'application/octet-stream', png)).resolves.toBe('image/png');
  await expect(validateDossierFile('report.exe', 'image/png', png)).rejects.toThrow('invalid');
  await expect(validateDossierFile('report.jpg', 'image/jpeg', png)).rejects.toThrow('invalid');
  await expect(validateDossierFile('report.png', 'text/plain', png)).rejects.toThrow('invalid');
});
