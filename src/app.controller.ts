import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

@ApiTags('Health')
@Controller()
export class AppController {
  @Get(['', 'health'])
  @ApiOperation({ summary: 'Health check and service status' })
  @ApiResponse({ status: 200, description: 'Service is healthy' })
  getHealth() {
    return {
      status: 'ok',
      service: 'tudu-api',
      timestamp: new Date().toISOString(),
    };
  }
}
