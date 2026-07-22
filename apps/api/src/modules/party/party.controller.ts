import { Controller } from '@nestjs/common';
import { PartyService } from './party.service';

@Controller('parties')
export class PartyController {
  constructor(private readonly service: PartyService) {}
}
