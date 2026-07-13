export interface RenderedConnector {
  key: string;
  path: string;
  predecessorId: number;
  successorId: number;
  dashed: boolean;
  selected: boolean;
}

interface ConnectionLayerProps {
  width: number;
  height: number;
  connectors: RenderedConnector[];
  livePath: string | null;
  liveValid: boolean | null;
  onSelectConnector: (predecessorId: number, successorId: number) => void;
}

export function ConnectionLayer({ width, height, connectors, livePath, liveValid, onSelectConnector }: ConnectionLayerProps) {
  return (
    <svg className="board-connection-layer" width={width} height={height} style={{ width, height }}>
      {connectors.map((connector) => (
        <g key={connector.key}>
          <path
            d={connector.path}
            className="board-connector-hit"
            onClick={() => onSelectConnector(connector.predecessorId, connector.successorId)}
          />
          <path
            d={connector.path}
            className={`board-connector${connector.selected ? ' is-selected' : ''}`}
            strokeDasharray={connector.dashed ? '5 4' : undefined}
          />
        </g>
      ))}
      {livePath && (
        <path d={livePath} className={`board-connector-live${liveValid === false ? ' is-invalid' : ''}${liveValid ? ' is-valid' : ''}`} />
      )}
    </svg>
  );
}
