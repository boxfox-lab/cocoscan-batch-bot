import {
  Column,
  Entity,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  Index,
  OneToMany,
} from 'typeorm';
import { ArticleEntity } from './article.entity';

/** 콘텐츠 채널 구분 (코스트코 / 이마트 트레이더스) */
export type ContentChannelType = 'costco' | 'emart_traders';

/** 콘텐츠 소스 타입 (자동 크롤링 / 수동 등록) */
export type ContentSourceType = 'auto' | 'manual';

/** 처리 상태 */
export type ProcessStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'skipped';

@Entity('youtube')
@Index(['publishedAt'])
@Index(['link'], { unique: true })
@Index(['channelType'])
@Index(['sourceType'])
@Index(['processStatus'])
export class YoutubeEntity {
  @PrimaryGeneratedColumn()
  id: number;

  /** 콘텐츠 채널: costco(코스트코) | emart_traders(이마트 트레이더스). null이면 코스트코로 간주 */
  @Column({
    type: 'varchar',
    length: 32,
    name: 'channel_type',
    nullable: true,
    default: 'costco',
  })
  channelType: ContentChannelType | null;

  /** 콘텐츠 소스: auto(자동 크롤링) | manual(수동 등록) */
  @Column({
    type: 'varchar',
    length: 10,
    name: 'source_type',
    default: 'auto',
  })
  sourceType: ContentSourceType;

  @Column({ type: 'text' })
  link: string;

  @Column({ type: 'text' })
  channelName: string;

  @Column({ type: 'text' })
  channelId: string;

  @Column({ type: 'text', nullable: true })
  title: string;

  @Column({ type: 'text', nullable: true })
  snippet: string;

  @Column({ type: 'timestamp', name: 'published_at' })
  publishedAt: Date;

  /** @deprecated Article 엔티티 사용 권장 */
  @Column({ type: 'text', nullable: true })
  content: string;

  @Column({ type: 'text', nullable: true })
  summary: string;

  @Column({ type: 'text', nullable: true })
  thumbnail: string;

  /** 처리 상태 */
  @Column({
    type: 'varchar',
    length: 20,
    name: 'process_status',
    default: 'pending',
  })
  processStatus: ProcessStatus;

  /** 처리 메시지 (스킵/실패 사유) */
  @Column({ type: 'text', nullable: true, name: 'process_message' })
  processMessage: string | null;

  /** 처리 완료 시각 */
  @Column({ type: 'timestamp', nullable: true, name: 'processed_at' })
  processedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @OneToMany(() => ArticleEntity, (article) => article.youtube)
  articles: ArticleEntity[];
}
