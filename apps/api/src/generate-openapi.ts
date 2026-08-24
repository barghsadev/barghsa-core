import { NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module.js';
import * as fs from 'node:fs';
import * as path from 'node:path';

async function generateOpenApiSpec(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  const config = new DocumentBuilder()
    .setTitle('Barghsa API')
    .setDescription('Iranian electricity market intelligence platform')
    .setVersion('0.1.0')
    .build();

  const document = SwaggerModule.createDocument(app, config);

  const outputPath = path.resolve('dist', 'openapi.json');
  fs.writeFileSync(outputPath, JSON.stringify(document, null, 2));
  console.log(`OpenAPI specification written to ${outputPath}`);

  await app.close();
}

generateOpenApiSpec();