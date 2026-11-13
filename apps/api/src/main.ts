import 'reflect-metadata';
import './database/env';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({ origin: process.env.CORS_ORIGIN ?? 'http://localhost:5180' });
  const doc = SwaggerModule.createDocument(app, new DocumentBuilder().setTitle('Mini ERP API').addBearerAuth().build());
  SwaggerModule.setup('docs', app, doc, { jsonDocumentUrl: 'docs/openapi.json' });
  const port = Number(process.env.API_PORT ?? 3100);
  await app.listen(port);
  console.log(`API listening on http://localhost:${port} (OpenAPI: /docs)`);
}
void bootstrap();
