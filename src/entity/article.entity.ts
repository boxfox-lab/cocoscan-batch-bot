import {
  Column,
  Entity,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from "typeorm";
import { YoutubeEntity } from "./youtube.entity";

@Entity("article")
export class ArticleEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Index()
  @Column({ type: "text", name: "youtube_link" })
  youtubeLink: string;

  @ManyToOne(() => YoutubeEntity, (youtube) => youtube.articles, {
    onDelete: "CASCADE",
  })
  @JoinColumn({ name: "youtube_link", referencedColumnName: "link" })
  youtube: YoutubeEntity;

  @Column({ type: "text", name: "topic_title", nullable: true })
  topicTitle: string;

  @Index()
  @Column({ type: "text", nullable: true })
  category: string;

  @Column({ type: "text", nullable: true })
  title: string;

  @Column({ type: "text", nullable: true })
  content: string;

  @Column({ type: "text", nullable: true })
  summary: string;

  @Column({ type: "json", nullable: true })
  keywords: string[];

  @Column({ type: "json", nullable: true })
  products: any[];

  @Column({ type: "text", nullable: true })
  thumbnail: string;

  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;

  @UpdateDateColumn({ name: "updated_at" })
  updatedAt: Date;
}
