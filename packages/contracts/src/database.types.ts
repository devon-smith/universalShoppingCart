export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      cart_invitations: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          cart_id: string
          created_at: string
          email: string | null
          expires_at: string
          id: string
          invited_by: string
          role: Database["public"]["Enums"]["cart_role"]
          token_hash: string
          updated_at: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          cart_id: string
          created_at?: string
          email?: string | null
          expires_at: string
          id?: string
          invited_by: string
          role: Database["public"]["Enums"]["cart_role"]
          token_hash: string
          updated_at?: string
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          cart_id?: string
          created_at?: string
          email?: string | null
          expires_at?: string
          id?: string
          invited_by?: string
          role?: Database["public"]["Enums"]["cart_role"]
          token_hash?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cart_invitations_cart_id_fkey"
            columns: ["cart_id"]
            isOneToOne: false
            referencedRelation: "carts"
            referencedColumns: ["id"]
          },
        ]
      }
      cart_members: {
        Row: {
          cart_id: string
          created_at: string
          role: Database["public"]["Enums"]["cart_role"]
          updated_at: string
          user_id: string
        }
        Insert: {
          cart_id: string
          created_at?: string
          role?: Database["public"]["Enums"]["cart_role"]
          updated_at?: string
          user_id: string
        }
        Update: {
          cart_id?: string
          created_at?: string
          role?: Database["public"]["Enums"]["cart_role"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cart_members_cart_id_fkey"
            columns: ["cart_id"]
            isOneToOne: false
            referencedRelation: "carts"
            referencedColumns: ["id"]
          },
        ]
      }
      carts: {
        Row: {
          created_at: string
          default_currency: string | null
          description: string | null
          id: string
          is_default: boolean
          name: string
          owner_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          default_currency?: string | null
          description?: string | null
          id?: string
          is_default?: boolean
          name: string
          owner_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          default_currency?: string | null
          description?: string | null
          id?: string
          is_default?: boolean
          name?: string
          owner_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      item_observations: {
        Row: {
          availability: Database["public"]["Enums"]["item_availability"]
          confidence: number | null
          currency: string | null
          extractor_id: string | null
          extractor_version: string | null
          id: number
          item_id: string
          observed_at: string
          original_price: number | null
          price: number | null
          source: Database["public"]["Enums"]["observation_source"]
        }
        Insert: {
          availability?: Database["public"]["Enums"]["item_availability"]
          confidence?: number | null
          currency?: string | null
          extractor_id?: string | null
          extractor_version?: string | null
          id?: never
          item_id: string
          observed_at?: string
          original_price?: number | null
          price?: number | null
          source: Database["public"]["Enums"]["observation_source"]
        }
        Update: {
          availability?: Database["public"]["Enums"]["item_availability"]
          confidence?: number | null
          currency?: string | null
          extractor_id?: string | null
          extractor_version?: string | null
          id?: never
          item_id?: string
          observed_at?: string
          original_price?: number | null
          price?: number | null
          source?: Database["public"]["Enums"]["observation_source"]
        }
        Relationships: [
          {
            foreignKeyName: "item_observations_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
        ]
      }
      items: {
        Row: {
          availability: Database["public"]["Enums"]["item_availability"]
          brand: string | null
          canonical_url: string | null
          cart_id: string
          composition: string | null
          created_at: string
          created_by: string
          currency: string | null
          current_price: number | null
          description: string | null
          desired_price: number | null
          domain: string
          extraction_confidence: number | null
          extractor_id: string | null
          extractor_version: string | null
          fingerprint: string
          id: string
          identifiers: Json
          image_url: string | null
          last_observed_at: string | null
          note: string | null
          original_price: number | null
          priority: Database["public"]["Enums"]["item_priority"]
          product_availability:
            | Database["public"]["Enums"]["item_availability"]
            | null
          quantity: number
          retailer_name: string
          selected_variant: Json
          source_url: string
          status: Database["public"]["Enums"]["item_status"]
          title: string
          updated_at: string
        }
        Insert: {
          availability?: Database["public"]["Enums"]["item_availability"]
          brand?: string | null
          canonical_url?: string | null
          cart_id: string
          composition?: string | null
          created_at?: string
          created_by: string
          currency?: string | null
          current_price?: number | null
          description?: string | null
          desired_price?: number | null
          domain: string
          extraction_confidence?: number | null
          extractor_id?: string | null
          extractor_version?: string | null
          fingerprint: string
          id?: string
          identifiers?: Json
          image_url?: string | null
          last_observed_at?: string | null
          note?: string | null
          original_price?: number | null
          priority?: Database["public"]["Enums"]["item_priority"]
          product_availability?:
            | Database["public"]["Enums"]["item_availability"]
            | null
          quantity?: number
          retailer_name: string
          selected_variant?: Json
          source_url: string
          status?: Database["public"]["Enums"]["item_status"]
          title: string
          updated_at?: string
        }
        Update: {
          availability?: Database["public"]["Enums"]["item_availability"]
          brand?: string | null
          canonical_url?: string | null
          cart_id?: string
          composition?: string | null
          created_at?: string
          created_by?: string
          currency?: string | null
          current_price?: number | null
          description?: string | null
          desired_price?: number | null
          domain?: string
          extraction_confidence?: number | null
          extractor_id?: string | null
          extractor_version?: string | null
          fingerprint?: string
          id?: string
          identifiers?: Json
          image_url?: string | null
          last_observed_at?: string | null
          note?: string | null
          original_price?: number | null
          priority?: Database["public"]["Enums"]["item_priority"]
          product_availability?:
            | Database["public"]["Enums"]["item_availability"]
            | null
          quantity?: number
          retailer_name?: string
          selected_variant?: Json
          source_url?: string
          status?: Database["public"]["Enums"]["item_status"]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "items_cart_id_fkey"
            columns: ["cart_id"]
            isOneToOne: false
            referencedRelation: "carts"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_events: {
        Row: {
          created_at: string
          currency: string | null
          id: number
          item_id: string
          observed_value: string | null
          seen_at: string | null
          type: Database["public"]["Enums"]["notification_type"]
        }
        Insert: {
          created_at?: string
          currency?: string | null
          id?: never
          item_id: string
          observed_value?: string | null
          seen_at?: string | null
          type: Database["public"]["Enums"]["notification_type"]
        }
        Update: {
          created_at?: string
          currency?: string | null
          id?: never
          item_id?: string
          observed_value?: string | null
          seen_at?: string | null
          type?: Database["public"]["Enums"]["notification_type"]
        }
        Relationships: [
          {
            foreignKeyName: "notification_events_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          default_currency: string
          display_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          default_currency?: string
          display_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          default_currency?: string
          display_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      refresh_jobs: {
        Row: {
          consecutive_failures: number
          created_at: string
          disabled: boolean
          item_id: string
          last_ok: boolean | null
          last_run_at: string | null
          next_run_at: string
          strategy: Database["public"]["Enums"]["refresh_strategy"]
          updated_at: string
        }
        Insert: {
          consecutive_failures?: number
          created_at?: string
          disabled?: boolean
          item_id: string
          last_ok?: boolean | null
          last_run_at?: string | null
          next_run_at?: string
          strategy?: Database["public"]["Enums"]["refresh_strategy"]
          updated_at?: string
        }
        Update: {
          consecutive_failures?: number
          created_at?: string
          disabled?: boolean
          item_id?: string
          last_ok?: boolean | null
          last_run_at?: string | null
          next_run_at?: string
          strategy?: Database["public"]["Enums"]["refresh_strategy"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "refresh_jobs_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: true
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      item_price_summary: {
        Row: {
          item_id: string | null
          latest_availability:
            | Database["public"]["Enums"]["item_availability"]
            | null
          latest_currency: string | null
          latest_observed_at: string | null
          latest_original_price: number | null
          latest_price: number | null
          observation_count: number | null
          previous_observed_at: string | null
          previous_price: number | null
        }
        Relationships: [
          {
            foreignKeyName: "item_observations_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      accept_cart_invitation: { Args: { p_token: string }; Returns: Json }
      can_edit_cart: { Args: { p_cart_id: string }; Returns: boolean }
      can_read_cart: { Args: { p_cart_id: string }; Returns: boolean }
      create_cart_invitation: {
        Args: {
          p_cart_id: string
          p_email?: string
          p_role: Database["public"]["Enums"]["cart_role"]
          p_ttl?: string
        }
        Returns: Json
      }
      enqueue_refresh_job: {
        Args: {
          p_item_id: string
          p_strategy?: Database["public"]["Enums"]["refresh_strategy"]
        }
        Returns: Json
      }
      ingest_product_capture: {
        Args: {
          p_capture: Json
          p_cart_id: string
          p_fingerprint: string
          p_source?: Database["public"]["Enums"]["observation_source"]
          p_user_fields?: Json
        }
        Returns: Json
      }
      observation_refresh_interval: { Args: never; Returns: string }
      owns_cart: { Args: { p_cart_id: string }; Returns: boolean }
      parse_money: { Args: { p_value: string }; Returns: number }
      record_background_observation: {
        Args: {
          p_availability?: string
          p_confidence?: number
          p_currency?: string
          p_extractor_id?: string
          p_extractor_version?: string
          p_item_id: string
          p_original_price?: string
          p_price?: string
        }
        Returns: Json
      }
      record_notification: {
        Args: {
          p_currency?: string
          p_item_id: string
          p_observed_value?: string
          p_type: Database["public"]["Enums"]["notification_type"]
        }
        Returns: Json
      }
      record_refresh_result: {
        Args: { p_item_id: string; p_ok: boolean }
        Returns: Json
      }
      refresh_base_interval: { Args: never; Returns: string }
      refresh_max_failures: { Args: never; Returns: number }
      select_due_refresh_jobs: { Args: { p_limit?: number }; Returns: Json }
    }
    Enums: {
      cart_role: "owner" | "editor" | "viewer"
      item_availability:
        | "in_stock"
        | "out_of_stock"
        | "preorder"
        | "backorder"
        | "unknown"
      item_priority: "low" | "normal" | "high"
      item_status: "saved" | "cart" | "purchased" | "archived"
      notification_type:
        | "price_below_desired"
        | "back_in_stock"
        | "became_unavailable"
      observation_source: "capture" | "revisit" | "manual" | "background"
      refresh_strategy: "public_fetch" | "api" | "browser_required" | "disabled"
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      cart_role: ["owner", "editor", "viewer"],
      item_availability: [
        "in_stock",
        "out_of_stock",
        "preorder",
        "backorder",
        "unknown",
      ],
      item_priority: ["low", "normal", "high"],
      item_status: ["saved", "cart", "purchased", "archived"],
      observation_source: ["capture", "revisit", "manual", "background"],
    },
  },
} as const
