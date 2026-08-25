# T-03.03.03 — Profile Settings Page

## Plan

### Backend
1. `GET /api/profiles/:id` — returns full profile details with addresses and legal info (if legal)
2. `PUT /api/profiles/:id` — update editable fields with field-level validation

### Frontend
1. `/app/settings/profile` — profile settings page
   - Editable fields: address (province, city, full address, postal code), contact info
   - Read-only after verification: first name, last name, national ID (individual), legal name, national identifier (legal)
   - Staff can always update their own individual profile
   - Address changes create new address record (historical addresses retained)