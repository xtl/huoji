import { Controller } from '@nestjs/common';
import { DemandService } from './demand.service';

@Controller('demands')
export class DemandController {
  constructor(private readonly service: DemandService) {}
}
