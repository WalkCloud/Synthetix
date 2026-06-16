export interface IconDef {
  id: string;
  label: string;
  category: string;
  brandColor: string;
  svgElements: string[];
}

export const PRODUCT_ICONS: Record<string, IconDef> = {
  openai: { id: "openai", label: "OpenAI", category: "AI/ML", brandColor: "#10a37f", svgElements: ['<circle cx="14" cy="14" r="12" fill="#10a37f" opacity="0.15"/>','<text x="14" y="18" text-anchor="middle" font-size="12" font-weight="bold" fill="#10a37f">OA</text>'] },
  anthropic: { id: "anthropic", label: "Anthropic", category: "AI/ML", brandColor: "#d97757", svgElements: ['<circle cx="14" cy="14" r="12" fill="#d97757" opacity="0.15"/>','<text x="14" y="18" text-anchor="middle" font-size="12" font-weight="bold" fill="#d97757">AN</text>'] },
  postgresql: { id: "postgresql", label: "PostgreSQL", category: "Database", brandColor: "#336791", svgElements: ['<circle cx="14" cy="14" r="12" fill="#336791" opacity="0.15"/>','<text x="14" y="18" text-anchor="middle" font-size="12" font-weight="bold" fill="#336791">PG</text>'] },
  mongodb: { id: "mongodb", label: "MongoDB", category: "Database", brandColor: "#47a248", svgElements: ['<circle cx="14" cy="14" r="12" fill="#47a248" opacity="0.15"/>','<text x="14" y="18" text-anchor="middle" font-size="12" font-weight="bold" fill="#47a248">MG</text>'] },
  redis: { id: "redis", label: "Redis", category: "Database", brandColor: "#dc382d", svgElements: ['<circle cx="14" cy="14" r="12" fill="#dc382d" opacity="0.15"/>','<text x="14" y="18" text-anchor="middle" font-size="12" font-weight="bold" fill="#dc382d">RD</text>'] },
  kafka: { id: "kafka", label: "Kafka", category: "Messaging", brandColor: "#231f20", svgElements: ['<circle cx="14" cy="14" r="12" fill="#231f20" opacity="0.15"/>','<text x="14" y="18" text-anchor="middle" font-size="12" font-weight="bold" fill="#231f20">KF</text>'] },
  aws: { id: "aws", label: "AWS", category: "Cloud", brandColor: "#ff9900", svgElements: ['<circle cx="14" cy="14" r="12" fill="#ff9900" opacity="0.15"/>','<text x="14" y="18" text-anchor="middle" font-size="12" font-weight="bold" fill="#ff9900">AW</text>'] },
  gcp: { id: "gcp", label: "GCP", category: "Cloud", brandColor: "#4285f4", svgElements: ['<circle cx="14" cy="14" r="12" fill="#4285f4" opacity="0.15"/>','<text x="14" y="18" text-anchor="middle" font-size="12" font-weight="bold" fill="#4285f4">GC</text>'] },
  azure: { id: "azure", label: "Azure", category: "Cloud", brandColor: "#0078d4", svgElements: ['<circle cx="14" cy="14" r="12" fill="#0078d4" opacity="0.15"/>','<text x="14" y="18" text-anchor="middle" font-size="12" font-weight="bold" fill="#0078d4">AZ</text>'] },
  pinecone: { id: "pinecone", label: "Pinecone", category: "VectorDB", brandColor: "#00b4d8", svgElements: ['<circle cx="14" cy="14" r="12" fill="#00b4d8" opacity="0.15"/>','<text x="14" y="18" text-anchor="middle" font-size="12" font-weight="bold" fill="#00b4d8">PC</text>'] },
  react: { id: "react", label: "React", category: "Frontend", brandColor: "#61dafb", svgElements: ['<circle cx="14" cy="14" r="12" fill="#61dafb" opacity="0.15"/>','<text x="14" y="18" text-anchor="middle" font-size="12" font-weight="bold" fill="#61dafb">Re</text>'] },
  nodejs: { id: "nodejs", label: "Node.js", category: "Backend", brandColor: "#339933", svgElements: ['<circle cx="14" cy="14" r="12" fill="#339933" opacity="0.15"/>','<text x="14" y="18" text-anchor="middle" font-size="12" font-weight="bold" fill="#339933">NJ</text>'] },
  docker: { id: "docker", label: "Docker", category: "DevOps", brandColor: "#2496ed", svgElements: ['<circle cx="14" cy="14" r="12" fill="#2496ed" opacity="0.15"/>','<text x="14" y="18" text-anchor="middle" font-size="12" font-weight="bold" fill="#2496ed">DK</text>'] },
  kubernetes: { id: "kubernetes", label: "Kubernetes", category: "DevOps", brandColor: "#326ce5", svgElements: ['<circle cx="14" cy="14" r="12" fill="#326ce5" opacity="0.15"/>','<text x="14" y="18" text-anchor="middle" font-size="12" font-weight="bold" fill="#326ce5">K8</text>'] },
  nginx: { id: "nginx", label: "Nginx", category: "Backend", brandColor: "#009639", svgElements: ['<circle cx="14" cy="14" r="12" fill="#009639" opacity="0.15"/>','<text x="14" y="18" text-anchor="middle" font-size="12" font-weight="bold" fill="#009639">NX</text>'] },
  rabbitmq: { id: "rabbitmq", label: "RabbitMQ", category: "Messaging", brandColor: "#ff6600", svgElements: ['<circle cx="14" cy="14" r="12" fill="#ff6600" opacity="0.15"/>','<text x="14" y="18" text-anchor="middle" font-size="12" font-weight="bold" fill="#ff6600">MQ</text>'] },
  elasticsearch: { id: "elasticsearch", label: "Elasticsearch", category: "Search", brandColor: "#005571", svgElements: ['<circle cx="14" cy="14" r="12" fill="#005571" opacity="0.15"/>','<text x="14" y="18" text-anchor="middle" font-size="12" font-weight="bold" fill="#005571">ES</text>'] },
  grafana: { id: "grafana", label: "Grafana", category: "Observability", brandColor: "#f46800", svgElements: ['<circle cx="14" cy="14" r="12" fill="#f46800" opacity="0.15"/>','<text x="14" y="18" text-anchor="middle" font-size="12" font-weight="bold" fill="#f46800">GF</text>'] },
  python: { id: "python", label: "Python", category: "Language", brandColor: "#3776ab", svgElements: ['<circle cx="14" cy="14" r="12" fill="#3776ab" opacity="0.15"/>','<text x="14" y="18" text-anchor="middle" font-size="12" font-weight="bold" fill="#3776ab">Py</text>'] },
};

export const ICON_CATEGORIES: Record<string, string[]> = {};
for (const icon of Object.values(PRODUCT_ICONS)) {
  if (!ICON_CATEGORIES[icon.category]) ICON_CATEGORIES[icon.category] = [];
  ICON_CATEGORIES[icon.category].push(icon.id);
}

export function getIcon(id: string): IconDef | undefined {
  return PRODUCT_ICONS[id];
}
