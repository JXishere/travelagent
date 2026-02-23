export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      contributors: {
        Row: {
          cities_contributed: string[] | null
          contribution_count: number | null
          created_at: string | null
          id: string
          name: string | null
          whatsapp_number: string
        }
        Insert: {
          cities_contributed?: string[] | null
          contribution_count?: number | null
          created_at?: string | null
          id?: string
          name?: string | null
          whatsapp_number: string
        }
        Update: {
          cities_contributed?: string[] | null
          contribution_count?: number | null
          created_at?: string | null
          id?: string
          name?: string | null
          whatsapp_number?: string
        }
        Relationships: []
      }
      conversations: {
        Row: {
          created_at: string | null
          current_flow: string | null
          flow_state: Json | null
          id: string
          last_user_message_at: string | null
          messages: Json | null
          updated_at: string | null
          whatsapp_number: string
        }
        Insert: {
          created_at?: string | null
          current_flow?: string | null
          flow_state?: Json | null
          id?: string
          last_user_message_at?: string | null
          messages?: Json | null
          updated_at?: string | null
          whatsapp_number: string
        }
        Update: {
          created_at?: string | null
          current_flow?: string | null
          flow_state?: Json | null
          id?: string
          last_user_message_at?: string | null
          messages?: Json | null
          updated_at?: string | null
          whatsapp_number?: string
        }
        Relationships: []
      }
      events: {
        Row: {
          channel: string
          created_at: string | null
          event_data: Json | null
          event_type: string
          id: string
          session_id: string
        }
        Insert: {
          channel: string
          created_at?: string | null
          event_data?: Json | null
          event_type: string
          id?: string
          session_id: string
        }
        Update: {
          channel?: string
          created_at?: string | null
          event_data?: Json | null
          event_type?: string
          id?: string
          session_id?: string
        }
        Relationships: []
      }
      feedback: {
        Row: {
          comments: string | null
          created_at: string | null
          id: string
          rating: number | null
          spot_id: string | null
          traveler_id: string | null
          user_tips: string[] | null
          visited: boolean | null
        }
        Insert: {
          comments?: string | null
          created_at?: string | null
          id?: string
          rating?: number | null
          spot_id?: string | null
          traveler_id?: string | null
          user_tips?: string[] | null
          visited?: boolean | null
        }
        Update: {
          comments?: string | null
          created_at?: string | null
          id?: string
          rating?: number | null
          spot_id?: string | null
          traveler_id?: string | null
          user_tips?: string[] | null
          visited?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "feedback_spot_id_fkey"
            columns: ["spot_id"]
            isOneToOne: false
            referencedRelation: "spots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feedback_traveler_id_fkey"
            columns: ["traveler_id"]
            isOneToOne: false
            referencedRelation: "travelers"
            referencedColumns: ["id"]
          },
        ]
      }
      happenings: {
        Row: {
          area: string | null
          categories: string[] | null
          city: string
          contributor_id: string | null
          country: string | null
          created_at: string | null
          description: string | null
          end_date: string
          id: string
          input_method: string | null
          name: string
          recurrence_rule: string | null
          recurring: boolean | null
          source_url: string | null
          start_date: string
          updated_at: string | null
        }
        Insert: {
          area?: string | null
          categories?: string[] | null
          city: string
          contributor_id?: string | null
          country?: string | null
          created_at?: string | null
          description?: string | null
          end_date: string
          id?: string
          input_method?: string | null
          name: string
          recurrence_rule?: string | null
          recurring?: boolean | null
          source_url?: string | null
          start_date: string
          updated_at?: string | null
        }
        Update: {
          area?: string | null
          categories?: string[] | null
          city?: string
          contributor_id?: string | null
          country?: string | null
          created_at?: string | null
          description?: string | null
          end_date?: string
          id?: string
          input_method?: string | null
          name?: string
          recurrence_rule?: string | null
          recurring?: boolean | null
          source_url?: string | null
          start_date?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "happenings_contributor_id_fkey"
            columns: ["contributor_id"]
            isOneToOne: false
            referencedRelation: "contributors"
            referencedColumns: ["id"]
          },
        ]
      }
      spot_contributions: {
        Row: {
          contributor_id: string
          created_at: string
          id: string
          must_go: boolean | null
          pro_tips: string[] | null
          spot_id: string
          vibe: string | null
          what_to_order: string[] | null
          what_to_skip: string[] | null
        }
        Insert: {
          contributor_id: string
          created_at?: string
          id?: string
          must_go?: boolean | null
          pro_tips?: string[] | null
          spot_id: string
          vibe?: string | null
          what_to_order?: string[] | null
          what_to_skip?: string[] | null
        }
        Update: {
          contributor_id?: string
          created_at?: string
          id?: string
          must_go?: boolean | null
          pro_tips?: string[] | null
          spot_id?: string
          vibe?: string | null
          what_to_order?: string[] | null
          what_to_skip?: string[] | null
        }
        Relationships: [
          {
            foreignKeyName: "spot_contributions_contributor_id_fkey"
            columns: ["contributor_id"]
            isOneToOne: false
            referencedRelation: "contributors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "spot_contributions_spot_id_fkey"
            columns: ["spot_id"]
            isOneToOne: false
            referencedRelation: "spots"
            referencedColumns: ["id"]
          },
        ]
      }
      spot_corrections: {
        Row: {
          correction_note: string | null
          correction_type: string
          created_at: string | null
          delta: Json | null
          id: string
          reporter_id: string
          spot_id: string | null
        }
        Insert: {
          correction_note?: string | null
          correction_type: string
          created_at?: string | null
          delta?: Json | null
          id?: string
          reporter_id: string
          spot_id?: string | null
        }
        Update: {
          correction_note?: string | null
          correction_type?: string
          created_at?: string | null
          delta?: Json | null
          id?: string
          reporter_id?: string
          spot_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "spot_corrections_spot_id_fkey"
            columns: ["spot_id"]
            isOneToOne: false
            referencedRelation: "spots"
            referencedColumns: ["id"]
          },
        ]
      }
      spots: {
        Row: {
          address: string | null
          area: string | null
          avg_rating: number | null
          best_time_of_day: string | null
          categories: string[] | null
          city: string
          contribution_count: number | null
          contributor_id: string | null
          country: string | null
          created_at: string | null
          embedding: string | null
          id: string
          indoor_outdoor: string | null
          input_method: string | null
          is_closed: boolean
          last_verified: string | null
          latitude: number | null
          longitude: number | null
          must_go: boolean | null
          name: string
          needs_review: boolean | null
          price_range: string | null
          pro_tips: string[] | null
          recommendation_count: number | null
          verified: boolean | null
          vibe: string | null
          weather_dependent: boolean | null
          what_to_order: string[] | null
          what_to_skip: string[] | null
        }
        Insert: {
          address?: string | null
          area?: string | null
          avg_rating?: number | null
          best_time_of_day?: string | null
          categories?: string[] | null
          city?: string
          contribution_count?: number | null
          contributor_id?: string | null
          country?: string | null
          created_at?: string | null
          embedding?: string | null
          id?: string
          indoor_outdoor?: string | null
          input_method?: string | null
          is_closed?: boolean
          last_verified?: string | null
          latitude?: number | null
          longitude?: number | null
          must_go?: boolean | null
          name: string
          needs_review?: boolean | null
          price_range?: string | null
          pro_tips?: string[] | null
          recommendation_count?: number | null
          verified?: boolean | null
          vibe?: string | null
          weather_dependent?: boolean | null
          what_to_order?: string[] | null
          what_to_skip?: string[] | null
        }
        Update: {
          address?: string | null
          area?: string | null
          avg_rating?: number | null
          best_time_of_day?: string | null
          categories?: string[] | null
          city?: string
          contribution_count?: number | null
          contributor_id?: string | null
          country?: string | null
          created_at?: string | null
          embedding?: string | null
          id?: string
          indoor_outdoor?: string | null
          input_method?: string | null
          is_closed?: boolean
          last_verified?: string | null
          latitude?: number | null
          longitude?: number | null
          must_go?: boolean | null
          name?: string
          needs_review?: boolean | null
          price_range?: string | null
          pro_tips?: string[] | null
          recommendation_count?: number | null
          verified?: boolean | null
          vibe?: string | null
          weather_dependent?: boolean | null
          what_to_order?: string[] | null
          what_to_skip?: string[] | null
        }
        Relationships: [
          {
            foreignKeyName: "spots_contributor_id_fkey"
            columns: ["contributor_id"]
            isOneToOne: false
            referencedRelation: "contributors"
            referencedColumns: ["id"]
          },
        ]
      }
      travelers: {
        Row: {
          created_at: string | null
          current_city: string | null
          dietary_restrictions: string[] | null
          first_time_visitor: boolean | null
          home_areas: string[]
          id: string
          last_proactive_at: string | null
          name: string | null
          preferences: Json | null
          spots_disliked: string[] | null
          spots_feedback_asked: string[] | null
          spots_liked: string[] | null
          spots_recommended: string[] | null
          travel_party: string | null
          trip_dates: Json | null
          user_type: string
          whatsapp_number: string
        }
        Insert: {
          created_at?: string | null
          current_city?: string | null
          dietary_restrictions?: string[] | null
          first_time_visitor?: boolean | null
          home_areas?: string[]
          id?: string
          last_proactive_at?: string | null
          name?: string | null
          preferences?: Json | null
          spots_disliked?: string[] | null
          spots_feedback_asked?: string[] | null
          spots_liked?: string[] | null
          spots_recommended?: string[] | null
          travel_party?: string | null
          trip_dates?: Json | null
          user_type?: string
          whatsapp_number: string
        }
        Update: {
          created_at?: string | null
          current_city?: string | null
          dietary_restrictions?: string[] | null
          first_time_visitor?: boolean | null
          home_areas?: string[]
          id?: string
          last_proactive_at?: string | null
          name?: string | null
          preferences?: Json | null
          spots_disliked?: string[] | null
          spots_feedback_asked?: string[] | null
          spots_liked?: string[] | null
          spots_recommended?: string[] | null
          travel_party?: string | null
          trip_dates?: Json | null
          user_type?: string
          whatsapp_number?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      append_conversation_messages: {
        Args: {
          p_max_messages?: number
          p_new_messages: Json
          p_phone_number: string
        }
        Returns: undefined
      }
      daily_stats: {
        Args: { from_date?: string; to_date?: string }
        Returns: {
          day: string
          flow_completions: number
          recommendations: number
          top_intent: string
          total_messages: number
          unique_sessions: number
          web_messages: number
          whatsapp_messages: number
        }[]
      }
      get_city_stats: { Args: { target_city?: string }; Returns: Json }
      increment_recommendation_count: {
        Args: { p_spot_id: string }
        Returns: undefined
      }
      increment_spot_contribution_count: {
        Args: { p_spot_id: string }
        Returns: undefined
      }
      match_spots: {
        Args: {
          filter_categories?: string[]
          filter_city?: string
          match_limit?: number
          match_threshold?: number
          query_embedding: string
        }
        Returns: {
          address: string
          area: string
          best_time_of_day: string
          categories: string[]
          city: string
          contribution_count: number
          contributor_id: string
          country: string
          created_at: string
          embedding: string
          google_pin_accurate: boolean
          id: string
          indoor_outdoor: string
          latitude: number
          longitude: number
          must_go: boolean
          name: string
          opening_hours: Json
          payment_methods: string[]
          price_range: string
          pro_tips: string[]
          similarity: number
          source: string
          use_count: number
          verified: boolean
          vibe: string
          weather_dependent: boolean
          what_to_order: string[]
          what_to_skip: string[]
        }[]
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
