import { maskSensitiveData } from '@utils/masking';

describe('maskSensitiveData', () => {
  it('should mask all but last 4 characters', () => {
    expect(maskSensitiveData('4111111111111111')).toBe('************1111');
  });

  it('should mask a bank account number', () => {
    expect(maskSensitiveData('123456789')).toBe('*****6789');
  });

  it('should mask a routing number', () => {
    expect(maskSensitiveData('021000021')).toBe('*****0021');
  });

  it('should mask all characters when length is 4 or less', () => {
    expect(maskSensitiveData('1234')).toBe('****');
    expect(maskSensitiveData('abc')).toBe('***');
    expect(maskSensitiveData('ab')).toBe('**');
    expect(maskSensitiveData('a')).toBe('*');
  });

  it('should handle exactly 5 characters', () => {
    expect(maskSensitiveData('12345')).toBe('*2345');
  });

  it('should preserve the output length equal to input length', () => {
    const input = '9876543210123456';
    const masked = maskSensitiveData(input);
    expect(masked.length).toBe(input.length);
  });

  it('should handle empty string', () => {
    expect(maskSensitiveData('')).toBe('');
  });
});
