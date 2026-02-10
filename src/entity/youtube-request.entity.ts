import {
  Column,
  Entity,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  Index,
} from "typeorm";
import { ContentChannelType, ProcessStatus } from "./youtube.entity";

export { ContentChannelType, ProcessStatus };

@Entity("youtube_request")
@Index(["link"], { unique: true })
@Index(["processStatus"])
export class YoutubeRequestEntity {
  @PrimaryGeneratedColumn()
  id: number;

  /** 유튜브 영상 링크 */
  @Column({ type: "text" })
  link: string;

  /** 콘텐츠 채널: costco | emart_traders */
  @Column({
    type: "varchar",
    length: 32,
    name: "channel_type",
    nullable: true,
    default: "costco",
  })
  channelType: ContentChannelType | null;

  /** 처리 상태 */
  @Column({
    type: "varchar",
    length: 20,
    name: "process_status",
    default: "pending",
  })
  processStatus: ProcessStatus;

  /** 처리 메시지 (스킵/실패 사유) */
  @Column({ type: "text", nullable: true, name: "process_message" })
  processMessage: string | null;

  /** 처리 완료 시각 */
  @Column({ type: "timestamp", nullable: true, name: "processed_at" })
  processedAt: Date | null;

  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;
}
