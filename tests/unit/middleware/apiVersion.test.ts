import { Request, Response, NextFunction } from 'express';
import { apiVersionMiddleware } from '../../../src/middleware/apiVersion';

describe('API Version Middleware', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;
  let jsonSpy: jest.Mock;

  beforeEach(() => {
    mockReq = {};
    jsonSpy = jest.fn().mockReturnThis();
    mockRes = {
      json: jsonSpy,
    };
    mockNext = jest.fn();
  });

  it('should inject version "v1" into object responses for v1 middleware', () => {
    const middleware = apiVersionMiddleware('v1');
    middleware(mockReq as Request, mockRes as Response, mockNext);

    expect(mockNext).toHaveBeenCalled();

    // Now call res.json with an object
    mockRes.json!({ status: 'ok', data: 'test' });

    expect(jsonSpy).toHaveBeenCalledWith(
      expect.objectContaining({ version: 'v1', status: 'ok', data: 'test' })
    );
  });

  it('should inject version "v2" into object responses for v2 middleware', () => {
    const middleware = apiVersionMiddleware('v2');
    middleware(mockReq as Request, mockRes as Response, mockNext);

    expect(mockNext).toHaveBeenCalled();

    mockRes.json!({ status: 'ok', data: 'test' });

    expect(jsonSpy).toHaveBeenCalledWith(
      expect.objectContaining({ version: 'v2', status: 'ok', data: 'test' })
    );
  });

  it('should wrap array responses with version field', () => {
    const middleware = apiVersionMiddleware('v1');
    middleware(mockReq as Request, mockRes as Response, mockNext);

    mockRes.json!([{ id: 1 }, { id: 2 }]);

    expect(jsonSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        version: 'v1',
        data: [{ id: 1 }, { id: 2 }],
      })
    );
  });

  it('should pass through non-object/non-array values unchanged', () => {
    const middleware = apiVersionMiddleware('v1');
    middleware(mockReq as Request, mockRes as Response, mockNext);

    mockRes.json!(null);

    expect(jsonSpy).toHaveBeenCalledWith(null);
  });
});
