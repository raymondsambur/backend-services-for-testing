import { calculateOffset, buildPaginationMeta } from '@utils/pagination';

describe('Pagination Utilities', () => {
  describe('calculateOffset', () => {
    it('should return 0 for page 1', () => {
      expect(calculateOffset({ page: 1, limit: 20 })).toBe(0);
    });

    it('should calculate correct offset for page 2 with limit 20', () => {
      expect(calculateOffset({ page: 2, limit: 20 })).toBe(20);
    });

    it('should calculate correct offset for page 3 with limit 10', () => {
      expect(calculateOffset({ page: 3, limit: 10 })).toBe(20);
    });
  });

  describe('buildPaginationMeta', () => {
    it('should build correct meta for first page', () => {
      const meta = buildPaginationMeta(50, { page: 1, limit: 20 });
      expect(meta).toEqual({
        total: 50,
        page: 1,
        totalPages: 3,
        hasNext: true,
        hasPrevious: false,
      });
    });

    it('should build correct meta for middle page', () => {
      const meta = buildPaginationMeta(50, { page: 2, limit: 20 });
      expect(meta).toEqual({
        total: 50,
        page: 2,
        totalPages: 3,
        hasNext: true,
        hasPrevious: true,
      });
    });

    it('should build correct meta for last page', () => {
      const meta = buildPaginationMeta(50, { page: 3, limit: 20 });
      expect(meta).toEqual({
        total: 50,
        page: 3,
        totalPages: 3,
        hasNext: false,
        hasPrevious: true,
      });
    });

    it('should handle zero total items', () => {
      const meta = buildPaginationMeta(0, { page: 1, limit: 20 });
      expect(meta).toEqual({
        total: 0,
        page: 1,
        totalPages: 0,
        hasNext: false,
        hasPrevious: false,
      });
    });

    it('should handle page beyond total pages', () => {
      const meta = buildPaginationMeta(5, { page: 5, limit: 20 });
      expect(meta).toEqual({
        total: 5,
        page: 5,
        totalPages: 1,
        hasNext: false,
        hasPrevious: true,
      });
    });
  });
});
