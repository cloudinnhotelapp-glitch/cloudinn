// Text fields sent with an ID document upload (the file itself arrives as the multipart field "file").
import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import { GUEST_DOCUMENT_TYPES, type GuestDocumentType } from '@hms/shared';

// The kind of identity document the file shows.
export class UploadGuestDocumentDto {
  @ApiProperty({ enum: GUEST_DOCUMENT_TYPES })
  @IsIn(GUEST_DOCUMENT_TYPES, { message: 'documentType must be one of: Passport, National ID, Driving licence, Visa, Other' })
  documentType!: GuestDocumentType;
}
