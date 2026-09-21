import sys
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient


API_DIR = Path(__file__).resolve().parents[1] / "api"
if str(API_DIR) not in sys.path:
    sys.path.insert(0, str(API_DIR))

import server


class ServerStartupTests(unittest.TestCase):
    def test_health_does_not_initialize_data_plane_clients(self) -> None:
        with (
            patch.object(server, "_get_cosmos_container") as get_cosmos_container,
            patch.object(server, "_get_blob_service") as get_blob_service,
            TestClient(server.app) as client,
        ):
            response = client.get("/api/health")

        self.assertEqual(200, response.status_code)
        self.assertEqual("ok", response.json()["status"])
        get_cosmos_container.assert_not_called()
        get_blob_service.assert_not_called()


if __name__ == "__main__":
    unittest.main()