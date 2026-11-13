import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Response } from 'express';
import { QueryFailedError } from 'typeorm';

/** Maps every error to RFC 9457 Problem Details with a stable `code`. */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemDetailsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'INTERNAL_ERROR';
    let detail: unknown = 'Unexpected error';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      // BusinessError carries its own stable code; plain HttpExceptions use the status name.
      code = (exception as { code?: string }).code ?? HttpStatus[status] ?? 'HTTP_ERROR';
      const body = exception.getResponse();
      detail = typeof body === 'object' && body && 'message' in body ? body.message : exception.message;
    } else if (exception instanceof QueryFailedError && (exception as { code?: string }).code === '23505') {
      status = HttpStatus.CONFLICT;
      code = 'DUPLICATE_VALUE';
      detail = 'A record with the same unique value already exists';
    } else {
      this.logger.error(exception);
    }

    res.status(status).type('application/problem+json').json({ type: 'about:blank', title: HttpStatus[status], status, code, detail });
  }
}
