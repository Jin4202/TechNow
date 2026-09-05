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
      article_feedback: {
        Row: {
          article_id: string
          created_at: string
          helpful: boolean
          id: string
          locale: Database["public"]["Enums"]["locale"]
          style_guide_version: string | null
          voter_key: string
        }
        Insert: {
          article_id: string
          created_at?: string
          helpful: boolean
          id?: string
          locale: Database["public"]["Enums"]["locale"]
          style_guide_version?: string | null
          voter_key: string
        }
        Update: {
          article_id?: string
          created_at?: string
          helpful?: boolean
          id?: string
          locale?: Database["public"]["Enums"]["locale"]
          style_guide_version?: string | null
          voter_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "article_feedback_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "articles"
            referencedColumns: ["id"]
          },
        ]
      }
      article_sources: {
        Row: {
          article_id: string
          fetched_at: string
          id: string
          ordinal: number
          publisher: string | null
          tier: number
          title: string | null
          url: string
        }
        Insert: {
          article_id: string
          fetched_at?: string
          id?: string
          ordinal: number
          publisher?: string | null
          tier: number
          title?: string | null
          url: string
        }
        Update: {
          article_id?: string
          fetched_at?: string
          id?: string
          ordinal?: number
          publisher?: string | null
          tier?: number
          title?: string | null
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "article_sources_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "articles"
            referencedColumns: ["id"]
          },
        ]
      }
      article_translations: {
        Row: {
          article_id: string
          body: Json
          created_at: string
          id: string
          locale: Database["public"]["Enums"]["locale"]
          one_line_summary: string
          title: string
        }
        Insert: {
          article_id: string
          body: Json
          created_at?: string
          id?: string
          locale: Database["public"]["Enums"]["locale"]
          one_line_summary: string
          title: string
        }
        Update: {
          article_id?: string
          body?: Json
          created_at?: string
          id?: string
          locale?: Database["public"]["Enums"]["locale"]
          one_line_summary?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "article_translations_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "articles"
            referencedColumns: ["id"]
          },
        ]
      }
      articles: {
        Row: {
          body: Json
          category: Database["public"]["Enums"]["category"]
          cover_image_url: string | null
          created_at: string
          follow_up_of: string | null
          held_back_count: number
          id: string
          importance_score: number | null
          one_line_summary: string
          published_at: string | null
          run_id: string | null
          score_impact: number | null
          score_interest: number | null
          score_novelty: number | null
          slug: string
          status: Database["public"]["Enums"]["article_status"]
          style_guide_version: string | null
          tags: string[]
          title: string
          topic_hash: string
        }
        Insert: {
          body: Json
          category: Database["public"]["Enums"]["category"]
          cover_image_url?: string | null
          created_at?: string
          follow_up_of?: string | null
          held_back_count?: number
          id?: string
          importance_score?: number | null
          one_line_summary: string
          published_at?: string | null
          run_id?: string | null
          score_impact?: number | null
          score_interest?: number | null
          score_novelty?: number | null
          slug: string
          status?: Database["public"]["Enums"]["article_status"]
          style_guide_version?: string | null
          tags?: string[]
          title: string
          topic_hash: string
        }
        Update: {
          body?: Json
          category?: Database["public"]["Enums"]["category"]
          cover_image_url?: string | null
          created_at?: string
          follow_up_of?: string | null
          held_back_count?: number
          id?: string
          importance_score?: number | null
          one_line_summary?: string
          published_at?: string | null
          run_id?: string | null
          score_impact?: number | null
          score_interest?: number | null
          score_novelty?: number | null
          slug?: string
          status?: Database["public"]["Enums"]["article_status"]
          style_guide_version?: string | null
          tags?: string[]
          title?: string
          topic_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "articles_follow_up_of_fkey"
            columns: ["follow_up_of"]
            isOneToOne: false
            referencedRelation: "articles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "articles_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "pipeline_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      monthly_summaries: {
        Row: {
          article_ids: string[]
          created_at: string
          id: string
          locale: Database["public"]["Enums"]["locale"]
          month_start: string
          summary_text: string
          user_id: string
        }
        Insert: {
          article_ids?: string[]
          created_at?: string
          id?: string
          locale: Database["public"]["Enums"]["locale"]
          month_start: string
          summary_text: string
          user_id: string
        }
        Update: {
          article_ids?: string[]
          created_at?: string
          id?: string
          locale?: Database["public"]["Enums"]["locale"]
          month_start?: string
          summary_text?: string
          user_id?: string
        }
        Relationships: []
      }
      pipeline_runs: {
        Row: {
          articles_published: number
          cost_cached_tokens: number
          cost_fixed: number
          cost_images: number
          cost_input_tokens: number
          cost_output_tokens: number
          cost_pages_fetched: number
          cost_search_calls: number
          cost_variable: number
          finished_at: string | null
          id: string
          notes: string | null
          run_type: Database["public"]["Enums"]["run_type"]
          started_at: string
          status: Database["public"]["Enums"]["run_status"]
          topics_seen: number
          topics_selected: number
        }
        Insert: {
          articles_published?: number
          cost_cached_tokens?: number
          cost_fixed?: number
          cost_images?: number
          cost_input_tokens?: number
          cost_output_tokens?: number
          cost_pages_fetched?: number
          cost_search_calls?: number
          cost_variable?: number
          finished_at?: string | null
          id?: string
          notes?: string | null
          run_type: Database["public"]["Enums"]["run_type"]
          started_at?: string
          status?: Database["public"]["Enums"]["run_status"]
          topics_seen?: number
          topics_selected?: number
        }
        Update: {
          articles_published?: number
          cost_cached_tokens?: number
          cost_fixed?: number
          cost_images?: number
          cost_input_tokens?: number
          cost_output_tokens?: number
          cost_pages_fetched?: number
          cost_search_calls?: number
          cost_variable?: number
          finished_at?: string | null
          id?: string
          notes?: string | null
          run_type?: Database["public"]["Enums"]["run_type"]
          started_at?: string
          status?: Database["public"]["Enums"]["run_status"]
          topics_seen?: number
          topics_selected?: number
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string | null
          id: string
          locale: Database["public"]["Enums"]["locale"]
          premium: boolean
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          id: string
          locale?: Database["public"]["Enums"]["locale"]
          premium?: boolean
        }
        Update: {
          created_at?: string
          display_name?: string | null
          id?: string
          locale?: Database["public"]["Enums"]["locale"]
          premium?: boolean
        }
        Relationships: []
      }
      run_topics: {
        Row: {
          article_id: string | null
          created_at: string
          feed_names: string[]
          first_pass_score: number | null
          follow_up_of: string | null
          id: string
          importance_score: number | null
          item_count: number
          rank: number | null
          reason_impact: string | null
          reason_interest: string | null
          reason_novelty: string | null
          reject_reason: string | null
          rescore_skip_reason: string | null
          rescored: boolean
          run_id: string
          score_impact: number | null
          score_interest: number | null
          score_novelty: number | null
          selected: boolean
          topic_title: string
          trigger_url: string | null
        }
        Insert: {
          article_id?: string | null
          created_at?: string
          feed_names?: string[]
          first_pass_score?: number | null
          follow_up_of?: string | null
          id?: string
          importance_score?: number | null
          item_count: number
          rank?: number | null
          reason_impact?: string | null
          reason_interest?: string | null
          reason_novelty?: string | null
          reject_reason?: string | null
          rescore_skip_reason?: string | null
          rescored?: boolean
          run_id: string
          score_impact?: number | null
          score_interest?: number | null
          score_novelty?: number | null
          selected?: boolean
          topic_title: string
          trigger_url?: string | null
        }
        Update: {
          article_id?: string | null
          created_at?: string
          feed_names?: string[]
          first_pass_score?: number | null
          follow_up_of?: string | null
          id?: string
          importance_score?: number | null
          item_count?: number
          rank?: number | null
          reason_impact?: string | null
          reason_interest?: string | null
          reason_novelty?: string | null
          reject_reason?: string | null
          rescore_skip_reason?: string | null
          rescored?: boolean
          run_id?: string
          score_impact?: number | null
          score_interest?: number | null
          score_novelty?: number | null
          selected?: boolean
          topic_title?: string
          trigger_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "run_topics_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "articles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "run_topics_follow_up_of_fkey"
            columns: ["follow_up_of"]
            isOneToOne: false
            referencedRelation: "articles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "run_topics_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "pipeline_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      scraps: {
        Row: {
          article_id: string
          id: string
          scraped_at: string
          user_id: string
        }
        Insert: {
          article_id: string
          id?: string
          scraped_at?: string
          user_id: string
        }
        Update: {
          article_id?: string
          id?: string
          scraped_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "scraps_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "articles"
            referencedColumns: ["id"]
          },
        ]
      }
      seen_feed_items: {
        Row: {
          feed_name: string
          first_seen_on: string
          processed_at: string | null
          run_id: string | null
          status: Database["public"]["Enums"]["feed_item_status"]
          url_hash: string
        }
        Insert: {
          feed_name: string
          first_seen_on?: string
          processed_at?: string | null
          run_id?: string | null
          status?: Database["public"]["Enums"]["feed_item_status"]
          url_hash: string
        }
        Update: {
          feed_name?: string
          first_seen_on?: string
          processed_at?: string | null
          run_id?: string | null
          status?: Database["public"]["Enums"]["feed_item_status"]
          url_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "seen_feed_items_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "pipeline_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      source_texts: {
        Row: {
          article_id: string | null
          created_at: string
          expires_at: string
          extracted_text: string
          id: string
          run_id: string | null
          topic_hash: string
          url: string
        }
        Insert: {
          article_id?: string | null
          created_at?: string
          expires_at: string
          extracted_text: string
          id?: string
          run_id?: string | null
          topic_hash: string
          url: string
        }
        Update: {
          article_id?: string | null
          created_at?: string
          expires_at?: string
          extracted_text?: string
          id?: string
          run_id?: string | null
          topic_hash?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "source_texts_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "articles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "source_texts_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "pipeline_runs"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      article_status:
        | "draft"
        | "ready_pending"
        | "ready"
        | "published"
        | "failed"
        | "unpublished"
      category:
        | "ai-computing"
        | "space-astronomy"
        | "health-biotech"
        | "climate-energy"
        | "physics-materials"
        | "robotics-hardware"
        | "industry-policy"
      feed_item_status: "pending" | "processed"
      locale: "en" | "ko"
      run_status: "running" | "success" | "failed"
      run_type: "daily" | "monthly"
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
      article_status: [
        "draft",
        "ready_pending",
        "ready",
        "published",
        "failed",
        "unpublished",
      ],
      category: [
        "ai-computing",
        "space-astronomy",
        "health-biotech",
        "climate-energy",
        "physics-materials",
        "robotics-hardware",
        "industry-policy",
      ],
      feed_item_status: ["pending", "processed"],
      locale: ["en", "ko"],
      run_status: ["running", "success", "failed"],
      run_type: ["daily", "monthly"],
    },
  },
} as const

