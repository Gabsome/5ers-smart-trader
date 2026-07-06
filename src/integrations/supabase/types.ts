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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      amy_messages: {
        Row: {
          content: string
          created_at: string
          id: string
          role: string
          thread_id: string | null
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          role: string
          thread_id?: string | null
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          role?: string
          thread_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "amy_messages_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "amy_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      amy_threads: {
        Row: {
          created_at: string
          id: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          title?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          amy_context_trades: boolean
          amy_humor_level: number
          amy_personality: string
          amy_style_notes: string | null
          created_at: string
          current_balance: number
          current_mode: string
          daily_goal_usd: number
          display_name: string | null
          email: string | null
          id: string
          profit_target_usd: number
          risk_per_trade_pct: number
          starting_balance: number
          updated_at: string
          watched_pairs: string[]
        }
        Insert: {
          amy_context_trades?: boolean
          amy_humor_level?: number
          amy_personality?: string
          amy_style_notes?: string | null
          created_at?: string
          current_balance?: number
          current_mode?: string
          daily_goal_usd?: number
          display_name?: string | null
          email?: string | null
          id: string
          profit_target_usd?: number
          risk_per_trade_pct?: number
          starting_balance?: number
          updated_at?: string
          watched_pairs?: string[]
        }
        Update: {
          amy_context_trades?: boolean
          amy_humor_level?: number
          amy_personality?: string
          amy_style_notes?: string | null
          created_at?: string
          current_balance?: number
          current_mode?: string
          daily_goal_usd?: number
          display_name?: string | null
          email?: string | null
          id?: string
          profit_target_usd?: number
          risk_per_trade_pct?: number
          starting_balance?: number
          updated_at?: string
          watched_pairs?: string[]
        }
        Relationships: []
      }
      signals: {
        Row: {
          confidence: number
          created_at: string
          direction: string
          entry: number
          id: string
          indicators: Json | null
          mode_context: string | null
          pair: string
          rationale: string | null
          stop_loss: number
          suggested_lot: number | null
          take_profit_1: number
          take_profit_2: number | null
          timeframe: string
          user_id: string
        }
        Insert: {
          confidence?: number
          created_at?: string
          direction: string
          entry: number
          id?: string
          indicators?: Json | null
          mode_context?: string | null
          pair: string
          rationale?: string | null
          stop_loss: number
          suggested_lot?: number | null
          take_profit_1: number
          take_profit_2?: number | null
          timeframe?: string
          user_id: string
        }
        Update: {
          confidence?: number
          created_at?: string
          direction?: string
          entry?: number
          id?: string
          indicators?: Json | null
          mode_context?: string | null
          pair?: string
          rationale?: string | null
          stop_loss?: number
          suggested_lot?: number | null
          take_profit_1?: number
          take_profit_2?: number | null
          timeframe?: string
          user_id?: string
        }
        Relationships: []
      }
      subscriptions: {
        Row: {
          created_at: string
          current_period_end: string | null
          id: string
          last_payment_at: string | null
          last_payment_usd: number | null
          paypal_last_order_id: string | null
          plan: string
          registration_paid: boolean
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          current_period_end?: string | null
          id?: string
          last_payment_at?: string | null
          last_payment_usd?: number | null
          paypal_last_order_id?: string | null
          plan?: string
          registration_paid?: boolean
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          current_period_end?: string | null
          id?: string
          last_payment_at?: string | null
          last_payment_usd?: number | null
          paypal_last_order_id?: string | null
          plan?: string
          registration_paid?: boolean
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      trades: {
        Row: {
          closed_at: string | null
          created_at: string
          direction: string
          entry: number
          id: string
          lot_size: number
          mode: string
          notes: string | null
          opened_at: string
          pair: string
          pips: number | null
          pnl_usd: number
          signal_id: string | null
          status: string
          stop_loss: number | null
          take_profit: number | null
          user_id: string
        }
        Insert: {
          closed_at?: string | null
          created_at?: string
          direction: string
          entry: number
          id?: string
          lot_size?: number
          mode?: string
          notes?: string | null
          opened_at?: string
          pair: string
          pips?: number | null
          pnl_usd?: number
          signal_id?: string | null
          status?: string
          stop_loss?: number | null
          take_profit?: number | null
          user_id: string
        }
        Update: {
          closed_at?: string | null
          created_at?: string
          direction?: string
          entry?: number
          id?: string
          lot_size?: number
          mode?: string
          notes?: string | null
          opened_at?: string
          pair?: string
          pips?: number | null
          pnl_usd?: number
          signal_id?: string | null
          status?: string
          stop_loss?: number | null
          take_profit?: number | null
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
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
