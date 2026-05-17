import { FieldValue } from 'firebase/firestore';

export interface Category {
  id: string;
  nameEn: string;
  nameSi: string;
  nameTa: string;
}

export interface GlossaryTerm {
  id: string;
  categoryId: string;
  english: string;
  sinhala: string;
  tamil: string;
  description?: string;
  createdAt: FieldValue;
  updatedAt: FieldValue;
}

export interface Suggestion {
  id?: string;
  userId: string;
  userEmail: string;
  english: string;
  sinhala: string;
  tamil: string;
  notes?: string;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: FieldValue;
}

export type Language = 'en' | 'si' | 'ta';
