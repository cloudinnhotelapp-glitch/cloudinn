// WhatsApp guest-feedback link for a guest in house (Room Dashboard). The server builds the "click to chat" link from the
// database (the guest's stored phone number and name, the business name, and the location's configured feedback link);
// staff open it themselves. CloudInn does not send the message, cannot tell whether it was sent or delivered, and never
// stores the message. Opening the link is audited without the message text or the phone number.
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { buildFeedbackMessage, normalizeWhatsAppPhone, whatsAppLink, type WhatsAppFeedback } from '@hms/shared';
import { AuditLogService } from '../audit-logs/audit-log.service.js';
import type { AuditActor, PropertyScope } from '../common/tenancy/property-scope.js';
import { PrismaService } from '../prisma/prisma.service.js';

// Service preparing the feedback link and auditing its use.
@Injectable()
export class StayFeedbackService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
  ) {}

  // The phone number, message, and link for an in-house stay of the active location (409 with the reason when the
  // location has no feedback link or the guest has no usable international phone number).
  async prepare(scope: PropertyScope, stayId: string): Promise<WhatsAppFeedback> {
    const stay = await this.load(scope, stayId);
    const url = stay.location.guestFeedbackUrl;
    if (!url) throw new ConflictException('No guest feedback link is set for this location. The platform administrator can add one in the location settings.');
    const phone = normalizeWhatsAppPhone(stay.reservationRoom.reservation.guest.phone);
    if (!phone.ok) throw new ConflictException(phone.reason);
    const message = buildFeedbackMessage(stay.reservationRoom.reservation.guest.fullName, stay.location.business.name, url);
    return { phone: phone.digits, message, url: whatsAppLink(phone.digits, message) };
  }

  // Records that staff opened the WhatsApp link (no message text, no phone number).
  async recordOpened(scope: PropertyScope, stayId: string, actor: AuditActor): Promise<void> {
    const stay = await this.load(scope, stayId);
    await this.audit.record({
      ...actor,
      ...scope,
      action: 'stay.whatsapp_feedback_opened',
      entityType: 'Stay',
      entityId: stay.id,
      metadata: { reservationNumber: stay.reservationRoom.reservation.reservationNumber, roomNumber: stay.reservationRoom.room.roomNumber },
    });
  }

  // Loads an in-house stay of the active location, or answers 404.
  private async load(scope: PropertyScope, stayId: string) {
    const stay = await this.prisma.stay.findFirst({
      where: { id: stayId, ...scope, status: 'IN_HOUSE' },
      select: {
        id: true,
        location: { select: { guestFeedbackUrl: true, business: { select: { name: true } } } },
        reservationRoom: {
          select: {
            room: { select: { roomNumber: true } },
            reservation: { select: { reservationNumber: true, guest: { select: { fullName: true, phone: true } } } },
          },
        },
      },
    });
    if (!stay) throw new NotFoundException('Stay not found.');
    return stay;
  }
}
