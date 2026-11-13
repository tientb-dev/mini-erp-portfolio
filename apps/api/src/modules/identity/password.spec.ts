import { hashPassword, verifyPassword } from './password';

describe('password', () => {
  it('verifies the right password and rejects a wrong one', async () => {
    const stored = await hashPassword('s3cret');
    expect(stored).toMatch(/^scrypt\$/);
    expect(await verifyPassword('s3cret', stored)).toBe(true);
    expect(await verifyPassword('wrong', stored)).toBe(false);
  });

  it('rejects malformed hashes', async () => {
    expect(await verifyPassword('x', 'plain-text')).toBe(false);
  });
});
