import { supabase } from '../lib/supabase';

export interface Client {
  id: string;
  name: string;
  contact_email?: string;
  contact_phone?: string;
  address?: string;
  created_at: string;
  user_id: string;
}

export interface CreateClientDTO {
  name: string;
  contact_email?: string;
  contact_phone?: string;
  address?: string;
}

export const clientsService = {
  async getAll() {
    const { data, error } = await supabase
      .from('clients')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data;
  },

  async getById(id: string) {
    const { data, error } = await supabase
      .from('clients')
      .select('*')
      .eq('id', id)
      .single();

    if (error) throw error;
    return data;
  },

  async create(client: CreateClientDTO) {
    const { data, error } = await supabase
      .from('clients')
      .insert([client])
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  async update(id: string, client: Partial<CreateClientDTO>) {
    const { data, error } = await supabase
      .from('clients')
      .update(client)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  async delete(id: string) {
    const { error } = await supabase
      .from('clients')
      .delete()
      .eq('id', id);

    if (error) throw error;
  },
};