<?php
declare(strict_types=1);

final class SubmissionRepository
{
    private string $jsonlPath;
    private PDO $pdo;

    public function __construct(string $jsonlPath, string $sqlitePath)
    {
        $this->jsonlPath = $jsonlPath;
        $directory = dirname($jsonlPath);
        if (!is_dir($directory) && !mkdir($directory, 0700, true) && !is_dir($directory)) {
            throw new RuntimeException('Storage directory could not be created.');
        }

        $this->pdo = new PDO('sqlite:' . $sqlitePath, null, null, [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false,
        ]);
        $this->initialise();
    }

    public function save(string $name, string $email, string $message): void
    {
        $createdAt = gmdate('c');
        $id = bin2hex(random_bytes(16));
        $record = [
            'id' => $id,
            'created_at' => $createdAt,
            'name' => $name,
            'email' => $email,
            'message' => $message,
        ];

        $line = json_encode($record, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR) . PHP_EOL;
        $handle = fopen($this->jsonlPath, 'ab');
        if ($handle === false) {
            throw new RuntimeException('Submission log could not be opened.');
        }

        try {
            if (!flock($handle, LOCK_EX)) {
                throw new RuntimeException('Submission log could not be locked.');
            }
            fwrite($handle, $line);
            fflush($handle);
            flock($handle, LOCK_UN);
        } finally {
            fclose($handle);
        }

        $statement = $this->pdo->prepare(
            'INSERT INTO submissions (id, created_at, name, email, message) VALUES (:id, :created_at, :name, :email, :message)'
        );
        $statement->execute($record);
    }

    /**
     * @return list<array{created_at: string, name: string, email: string, message: string}>
     */
    public function all(): array
    {
        $statement = $this->pdo->prepare(
            'SELECT created_at, name, email, message FROM submissions ORDER BY created_at DESC, id DESC'
        );
        $statement->execute();

        return $statement->fetchAll();
    }

    private function initialise(): void
    {
        $this->pdo->exec(
            'CREATE TABLE IF NOT EXISTS submissions (
                id TEXT PRIMARY KEY,
                created_at TEXT NOT NULL,
                name TEXT NOT NULL,
                email TEXT NOT NULL,
                message TEXT NOT NULL
            )'
        );
    }
}
